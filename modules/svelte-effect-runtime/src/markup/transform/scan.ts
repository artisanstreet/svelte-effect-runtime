import { analyze_event_body_yield_star, strip_arrow_function } from "./expressions.ts";
import { validate_rune_yield_usage } from "$/script-transform/runes.ts";
import { scan_svelte_effect_source } from "$/compiler/source-scan.ts";
import { collect_yield_star_nodes } from "$/script-transform/ast.ts";
import { contains_top_level_yield_star } from "$/detect.ts";
import type { MarkupCandidate, TagKind } from "./types.ts";
import { HELPERS } from "./constants.ts";

import MagicString from "magic-string";
import ts from "typescript";

interface SanitizeResult {
	code: string;
	candidates: MarkupCandidate[];
}

interface DeclarationYieldExpression {
	start: number;
	end: number;
	expr_text: string;
}

/**
 * Replaces markup `yield*` expressions with placeholders before Svelte parses
 * the component.
 *
 * @example
 * ```ts
 * const sanitized = sanitize_markup(
 *   `<p>{yield* loadLabel()}</p>`,
 *   "Label.svelte",
 * );
 * ```
 *
 * @since 2.0.0
 * @param content - Raw Svelte component source to scan for effectful markup
 *   expressions.
 * @param filename - Source filename used when validation errors need to point
 *   back to the component being transformed.
 * @returns Sanitized source plus placeholder candidates that should be lowered
 *   after Svelte classifies their markup positions.
 */
export function sanitize_markup(content: string, filename: string): SanitizeResult {
	const candidates: MarkupCandidate[] = [];
	const source_scan = scan_svelte_effect_source(content, filename);
	const magic = new MagicString(content);
	let helper_index = 0;

	for (const expression of source_scan.markup_expressions) {
		const open = expression.open;
		const close = expression.close;
		const inner = expression.inner;
		const trimmed = inner.trimStart();
		const leading_ws = inner.length - trimmed.length;
		const tag_info = get_tag_info(trimmed);
		const declaration_yields = collect_declaration_yield_expressions(
			content,
			open,
			leading_ws,
			trimmed,
			filename,
		);

		if (declaration_yields.length > 0) {
			for (const declaration_yield of declaration_yields) {
				const placeholder = `__SER___markup_placeholder_${helper_index}`;
				helper_index += 1;

				candidates.push({
					placeholder,
					start: declaration_yield.start,
					end: declaration_yield.end,
					expr_text: declaration_yield.expr_text,
					filename,
					key: "plain",
				});

				magic.overwrite(declaration_yield.start, declaration_yield.end, placeholder);
			}

			continue;
		}

		let expr_body = trimmed.slice(tag_info.prefix_length);

		/** For @const, only use the RHS after `=` as the expression body. */
		const equal_idx =
			tag_info.kind === "plain" && trimmed.startsWith("@const ")
				? expr_body.indexOf("=")
				: -1;

		/** Check if this is a callback handler containing yield*. */
		const is_event_callback = is_event_callback_expression(inner);

		/** Determine if this brace contains yield* that needs lowering. */
		const event_yield = is_event_callback ? analyze_event_yield(inner) : undefined;
		const has_yield =
			event_yield?.has_top_level_yield_star ?? contains_yield_star_in_text(expr_body);

		if (!has_yield) {
			continue;
		}

		/** The expression starts after the tag prefix. For @const, after the `=`. */
		let extra_prefix = 0;

		if (equal_idx !== -1) {
			const after_eq_raw = expr_body.slice(equal_idx + 1);
			expr_body = after_eq_raw.trimStart();
			extra_prefix = equal_idx + 1 + (after_eq_raw.length - expr_body.length);
		}

		const expr_start = open + 1 + leading_ws + tag_info.prefix_length + extra_prefix;

		/** For each/await, the expression ends before ` as ` or ` then `/` catch `. */
		let expr_end = close;

		const key = tag_info.kind;

		if (key === "each") {
			const as_idx = expr_body.lastIndexOf(" as ");
			if (as_idx !== -1) expr_end = expr_start + as_idx;
		}

		if (key === "await") {
			const then_idx = expr_body.indexOf(" then ");
			const catch_idx = expr_body.indexOf(" catch ");
			const boundary = Math.min(
				then_idx === -1 ? Infinity : then_idx,
				catch_idx === -1 ? Infinity : catch_idx,
			);
			if (boundary !== Infinity) expr_end = expr_start + boundary;
		}

		const expr_text = content.slice(expr_start, expr_end).trim();

		if (expr_text.length === 0) {
			continue;
		}

		validate_expression_yield_usage(expr_text, filename);

		if (key === "render" && !/^\s*yield\s*\*/.test(expr_text)) {
			const render_arg_yields = collect_expression_yield_expressions(
				content,
				expr_start,
				expr_text,
				filename,
			);

			if (render_arg_yields.length > 0) {
				for (const render_arg_yield of render_arg_yields) {
					const placeholder = `__SER___markup_placeholder_${helper_index}`;
					helper_index += 1;

					candidates.push({
						placeholder,
						start: render_arg_yield.start,
						end: render_arg_yield.end,
						expr_text: render_arg_yield.expr_text,
						filename,
						key: "render_argument",
					});

					magic.overwrite(render_arg_yield.start, render_arg_yield.end, placeholder);
				}

				continue;
			}
		}

		/** Create a placeholder and replace the expression (preserving tag prefixes). */
		const placeholder = `__SER___markup_placeholder_${helper_index}`;
		helper_index += 1;

		candidates.push({
			placeholder,
			start: expr_start,
			end: expr_end,
			expr_text,
			filename,
			key,
		});

		magic.overwrite(expr_start, expr_end, key === "render" ? `${placeholder}()` : placeholder);
	}

	return { code: magic.toString(), candidates };
}

function collect_expression_yield_expressions(
	content: string,
	expr_start: number,
	expr_text: string,
	filename: string,
): DeclarationYieldExpression[] {
	const source_file = ts.createSourceFile(
		"markup-expression.ts",
		`const __SER___expr = ${expr_text};`,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const stmt = source_file.statements[0];

	if (!stmt || !ts.isVariableStatement(stmt)) {
		return [];
	}

	validate_rune_yield_usage(stmt, source_file.text, filename);

	const initializer = stmt.declarationList.declarations[0]?.initializer;

	if (!initializer || !contains_top_level_yield_star(initializer)) {
		return [];
	}

	const prefix_length = source_file.text.indexOf(expr_text);
	const expressions: DeclarationYieldExpression[] = [];

	collect_yield_star_nodes(initializer, (yield_node) => {
		const start = expr_start + yield_node.getStart(source_file) - prefix_length;
		const end = expr_start + yield_node.end - prefix_length;
		const yielded_text = content.slice(start, end).trim();

		expressions.push({
			start,
			end,
			expr_text: yielded_text,
		});
	});

	return expressions;
}

interface TagInfo {
	kind: TagKind;
	prefix_length: number;
}

function get_tag_info(trimmed: string): TagInfo {
	if (trimmed.startsWith("#each ")) {
		return { kind: "each", prefix_length: "#each ".length };
	}
	if (trimmed.startsWith("#await ")) {
		return { kind: "await", prefix_length: "#await ".length };
	}
	if (trimmed.startsWith("@render ")) {
		return { kind: "render", prefix_length: "@render ".length };
	}

	/** Strip prefix-only tags — the expression starts after the tag keyword. */
	if (trimmed.startsWith("@attach ")) {
		return { kind: "plain", prefix_length: "@attach ".length };
	}
	if (trimmed.startsWith("#if ")) {
		return { kind: "plain", prefix_length: "#if ".length };
	}
	if (trimmed.startsWith(":else if ")) {
		return { kind: "plain", prefix_length: ":else if ".length };
	}
	if (trimmed.startsWith("#key ")) {
		return { kind: "plain", prefix_length: "#key ".length };
	}
	if (trimmed.startsWith("@const ")) {
		return { kind: "plain", prefix_length: "@const ".length };
	}
	if (trimmed.startsWith("@html ")) {
		return { kind: "plain", prefix_length: "@html ".length };
	}
	if (trimmed.startsWith("@debug ")) {
		return { kind: "plain", prefix_length: "@debug ".length };
	}
	if (trimmed.startsWith("...")) {
		return { kind: "plain", prefix_length: "...".length };
	}

	return { kind: "plain", prefix_length: 0 };
}

function collect_declaration_yield_expressions(
	content: string,
	open: number,
	leading_ws: number,
	trimmed: string,
	filename: string,
): DeclarationYieldExpression[] {
	if (!is_declaration_tag_text(trimmed)) {
		return [];
	}

	const source_text = `${trimmed};`;
	const source_file = ts.createSourceFile(
		"declaration-tag.ts",
		source_text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);

	const stmt = source_file.statements[0];

	if (!stmt || !ts.isVariableStatement(stmt)) {
		return [];
	}

	validate_rune_yield_usage(stmt, source_text, filename);

	const tag_start = open + 1 + leading_ws;

	return stmt.declarationList.declarations.flatMap((decl) => {
		const expressions: DeclarationYieldExpression[] = [];

		collect_yield_star_nodes(decl, (yield_node) => {
			const start = tag_start + yield_node.getStart(source_file);
			const end = tag_start + yield_node.end;
			const expr_text = content.slice(start, end).trim();

			expressions.push({
				start,
				end,
				expr_text,
			});
		});

		return expressions;
	});
}

function is_declaration_tag_text(trimmed: string): boolean {
	return /^(?:const|let)\s/.test(trimmed);
}

function validate_expression_yield_usage(expr_text: string, filename: string): void {
	const source_text = `const __SER___expr = ${expr_text};`;
	const source_file = ts.createSourceFile(
		"markup-expression.ts",
		source_text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const stmt = source_file.statements[0];

	if (!stmt) {
		return;
	}

	validate_rune_yield_usage(stmt, source_text, filename);
}

function is_event_callback_expression(inner: string): boolean {
	const trimmed = inner.trimStart();

	return (
		/^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(trimmed) ||
		/^(?:async\s+)?function\b/.test(trimmed)
	);
}

function analyze_event_yield(inner: string): {
	has_top_level_yield_star: boolean;
} {
	const event = strip_arrow_function(inner);
	const analysis = analyze_event_body_yield_star(event.body);
	const generated_run = new RegExp(
		`${HELPERS.dispatcher}(?:_\\d+)?\\.emit\\(\\{\\s*type:\\s*${HELPERS.codes}(?:_\\d+)?\\.Markup\\.Run`,
	);

	if (generated_run.test(event.body)) {
		return {
			has_top_level_yield_star: false,
		};
	}

	return {
		has_top_level_yield_star:
			analysis.has_top_level_yield_star ||
			analysis.has_nested_invalid_yield_star ||
			/\byield\s*\*/.test(event.body),
	};
}

function contains_yield_star_in_text(text: string): boolean {
	if (!/\byield\s*\*/.test(text)) return false;

	try {
		const sf = ts.createSourceFile(
			"expr.ts",
			`const x = ${text};`,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
		const stmt = sf.statements[0];
		if (!ts.isVariableStatement(stmt)) return false;
		const decl = stmt.declarationList.declarations[0];
		if (!decl?.initializer) return false;
		return contains_top_level_yield_star(decl.initializer);
	} catch {
		return true;
	}
}

/** Free identifier collection helpers for generated closures. */
