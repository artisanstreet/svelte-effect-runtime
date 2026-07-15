import type {
	HelperDeclaration,
	MarkupCandidate,
	MarkupHelperBindings,
	MarkupNameAllocator,
	MarkupTransformTarget,
	PendingRelocation,
	Replacement,
	TagKind,
} from "./types.ts";
import {
	analyze_event_body_yield_star,
	collect_free_identifiers,
	is_callback_function_expression,
} from "./expressions.ts";
import { AsyncEffectInEventCallbackError, YieldStarInEventCallbackError } from "$/errors.ts";
import type { EffectCallbackRewriteContext } from "./effect-bindings.ts";
import { normalize_effect_callback_yields } from "./effect-callbacks.ts";
import { collect_yield_star_nodes } from "$/script-transform/ast.ts";

import ts from "typescript";

interface ClassifiedCandidate {
	candidate: MarkupCandidate;
	kind: TagKind;
	attribute_name_replacement: AttributeNameReplacement | undefined;
}

interface AttributeNameReplacement {
	start: number;
	end: number;
	text: string;
}

type ExpressionRelocation = {
	originalStart: number;
	originalEnd: number;
	generatedStart: number;
	generatedEnd: number;
};

export function emit_replacements(
	classified: ClassifiedCandidate[],
	effect_context: EffectCallbackRewriteContext,
	helper_bindings: MarkupHelperBindings,
	name_allocator: MarkupNameAllocator,
	target: MarkupTransformTarget,
): Replacement[] {
	const expression_replacements = classified.map(({ candidate, kind }) =>
		emit_replacement(candidate, kind, effect_context, helper_bindings, name_allocator, target),
	);
	const attribute_replacements = unique_attribute_name_replacements(classified).map(
		(replacement) => ({
			start: replacement.start,
			end: replacement.end,
			text: replacement.text,
		}),
	);

	return [...attribute_replacements, ...expression_replacements];
}

function unique_attribute_name_replacements(
	classified: ClassifiedCandidate[],
): AttributeNameReplacement[] {
	const seen = new Set<string>();

	return classified
		.map((entry) => entry.attribute_name_replacement)
		.filter((replacement): replacement is AttributeNameReplacement => {
			if (!replacement) {
				return false;
			}

			const key = `${replacement.start}:${replacement.end}:${replacement.text}`;

			if (seen.has(key)) {
				return false;
			}

			seen.add(key);

			return true;
		});
}

function emit_replacement(
	candidate: MarkupCandidate,
	kind: TagKind,
	effect_context: EffectCallbackRewriteContext,
	helper_bindings: MarkupHelperBindings,
	name_allocator: MarkupNameAllocator,
	target: MarkupTransformTarget,
): Replacement {
	const normalized = normalize_effect_callback_yields(candidate.expr_text, effect_context);
	const normalized_candidate = {
		...candidate,
		expr_text: normalized.expr_text,
	};
	const id = make_cache_id(candidate);
	const id_text = JSON.stringify(id);
	const helper_name = make_helper_name(candidate, name_allocator);
	const is_server_target = target === "server";

	let replacement_text: string;
	let helpers: HelperDeclaration[];
	let relocation: PendingRelocation | undefined;

	if (kind === "await") {
		const effect = make_effect_helper(normalized_candidate, helper_name, helper_bindings);

		replacement_text = emit_promise_expression(
			id_text,
			effect,
			helper_bindings,
			"undefined",
			`{ ssr: "pending" }`,
		);
		helpers = [...normalized.helpers, effect.helper];
	} else if (kind === "render") {
		const effect = make_effect_helper(normalized_candidate, helper_name, helper_bindings);

		replacement_text = emit_render_expression(
			id_text,
			effect,
			candidate,
			helper_bindings,
			is_server_target,
		);
		helpers = [...normalized.helpers, effect.helper];
	} else if (kind === "render_argument") {
		const effect = make_effect_helper(normalized_candidate, helper_name, helper_bindings);

		replacement_text = emit_await_expression(
			id_text,
			effect,
			helper_bindings,
			server_fallback(is_server_target, "undefined"),
		);
		helpers = [...normalized.helpers, effect.helper];
	} else if (kind === "each") {
		const effect = make_effect_helper(normalized_candidate, helper_name, helper_bindings);

		replacement_text = emit_await_expression(
			id_text,
			effect,
			helper_bindings,
			server_fallback(is_server_target, "[]"),
		);
		helpers = [...normalized.helpers, effect.helper];
	} else if (kind === "event") {
		const event = make_event_handler(normalized_candidate, helper_bindings);

		replacement_text = event.text;
		helpers = normalized.helpers;
		relocation = make_pending_relocation(
			candidate,
			replacement_text,
			event.expr_text,
			event.relocation,
		);
	} else if (kind === "html") {
		const effect = make_inline_effect(normalized_candidate, helper_bindings);

		replacement_text = emit_await_expression(id_text, effect, helper_bindings);
		helpers = normalized.helpers;
		relocation = make_pending_relocation(
			candidate,
			replacement_text,
			effect.effect_text,
			effect.relocation,
		);
	} else {
		const effect = make_effect_helper(normalized_candidate, helper_name, helper_bindings);

		replacement_text = emit_await_expression(
			id_text,
			effect,
			helper_bindings,
			server_fallback(is_server_target, "undefined"),
		);
		helpers = [...normalized.helpers, effect.helper];
	}

	return {
		start: candidate.start,
		end: candidate.end,
		text: replacement_text,
		helpers,
		...(relocation ? { relocation } : {}),
	};
}

function make_event_handler(
	candidate: MarkupCandidate,
	helper_bindings: MarkupHelperBindings,
): { text: string; expr_text: string; relocation: ExpressionRelocation | undefined } {
	const expr_text = candidate.expr_text;

	if (is_callback_function_expression(expr_text)) {
		throw new YieldStarInEventCallbackError(candidate.filename, expr_text);
	}

	const analysis = analyze_event_body_yield_star(expr_text);

	if (analysis.has_nested_invalid_yield_star) {
		throw new AsyncEffectInEventCallbackError(candidate.filename, expr_text);
	}

	const wrapped_expr_text = wrap_yield_stars(expr_text, helper_bindings);

	return {
		expr_text: wrapped_expr_text,
		relocation: make_yield_operand_relocation(expr_text, wrapped_expr_text, helper_bindings),
		text: `(event) => { ${helper_bindings.dispatcher}.emit({ type: ${helper_bindings.codes}.Markup.Run, fn: function* () { ${wrapped_expr_text}; } }); }`,
	};
}

function emit_promise_expression(
	id_text: string,
	effect: EffectHelper,
	helper_bindings: MarkupHelperBindings,
	ssr_fallback?: string,
	options?: string,
): string {
	const properties = [
		`type: ${helper_bindings.codes}.Markup.Promise`,
		`id: ${id_text}`,
		`deps: ${effect.deps_text}`,
		`fn: () => ${effect.call}`,
		ssr_fallback !== undefined && `ssr_fallback: ${ssr_fallback}`,
		options !== undefined && `options: ${options}`,
	].filter((property): property is string => property !== false);

	return `${helper_bindings.dispatcher}.emit({ ${properties.join(", ")} })`;
}

function emit_render_expression(
	id_text: string,
	effect: EffectHelper,
	candidate: MarkupCandidate,
	helper_bindings: MarkupHelperBindings,
	is_server_target: boolean,
): string {
	const expression = emit_promise_expression(
		id_text,
		effect,
		helper_bindings,
		server_fallback(is_server_target, `() => undefined`),
	);

	if (/^\s*yield\s*\*/.test(candidate.expr_text)) {
		return `(await ${expression})()`;
	}

	return `await ${expression}`;
}

function emit_await_expression(
	id_text: string,
	effect: EffectHelper,
	helper_bindings: MarkupHelperBindings,
	ssr_fallback?: string,
): string {
	return `await ${emit_promise_expression(id_text, effect, helper_bindings, ssr_fallback)}`;
}

function server_fallback(is_server_target: boolean, fallback: string): string | undefined {
	return is_server_target ? fallback : undefined;
}

interface EffectHelper {
	call: string;
	deps_text: string;
}

interface DeclaredEffectHelper extends EffectHelper {
	helper: HelperDeclaration;
}

interface InlineEffectHelper extends EffectHelper {
	effect_text: string;
	relocation: ExpressionRelocation | undefined;
}

function make_effect_helper(
	candidate: MarkupCandidate,
	helper_name: string,
	helper_bindings: Pick<MarkupHelperBindings, "yieldable">,
): DeclaredEffectHelper {
	const deps = collect_free_identifiers(candidate.expr_text);
	const args_text = deps.join(", ");
	const deps_text = deps.length === 0 ? "[]" : `[${args_text}]`;
	const call = `${helper_name}()`;
	const effect_text = wrap_yield_stars(candidate.expr_text, helper_bindings);
	const text = `function* ${helper_name}() { return (${effect_text}); }`;
	const generated_start = text.indexOf(effect_text);
	const operand_relocation = make_yield_operand_relocation(
		candidate.expr_text,
		effect_text,
		helper_bindings,
	);
	const relocation =
		operand_relocation ??
		({
			originalStart: 0,
			originalEnd: candidate.expr_text.length,
			generatedStart: 0,
			generatedEnd: effect_text.length,
		} satisfies ExpressionRelocation);

	return {
		call,
		deps_text,
		helper: {
			text,
			relocation: {
				originalStart: candidate.start + relocation.originalStart,
				originalEnd: candidate.start + relocation.originalEnd,
				generatedStartInReplacement: generated_start + relocation.generatedStart,
				generatedEndInReplacement: generated_start + relocation.generatedEnd,
			},
		},
	};
}

function make_inline_effect(
	candidate: MarkupCandidate,
	helper_bindings: Pick<MarkupHelperBindings, "yieldable">,
): InlineEffectHelper {
	const deps = collect_free_identifiers(candidate.expr_text);
	const deps_text = deps.length === 0 ? "[]" : `[${deps.join(", ")}]`;
	const effect_text = wrap_yield_stars(candidate.expr_text, helper_bindings);
	const relocation = make_yield_operand_relocation(
		candidate.expr_text,
		effect_text,
		helper_bindings,
	);

	return {
		call: `(function* () { return (${effect_text}); })()`,
		deps_text,
		effect_text,
		relocation,
	};
}

function wrap_yield_stars(
	text: string,
	helper_bindings: Pick<MarkupHelperBindings, "yieldable">,
): string {
	const source_file = ts.createSourceFile(
		"markup-yield.ts",
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const replacements: Array<{
		start: number;
		end: number;
		text: string;
	}> = [];

	collect_yield_star_nodes(source_file, (node) => {
		const yield_text = text.slice(node.getStart(source_file), node.end).trim();

		replacements.push({
			start: node.getStart(source_file),
			end: node.end,
			text: `yield* ${helper_bindings.yieldable}(${strip_yield_star(yield_text)})`,
		});
	});

	if (replacements.length === 0) {
		return text;
	}

	replacements.sort((a, b) => b.start - a.start);

	let output = text;

	for (const replacement of replacements) {
		output =
			output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
	}

	return output;
}

function strip_yield_star(yield_text: string): string {
	return yield_text.replace(/^yield\s*\*\s*/, "");
}

function make_yield_operand_relocation(
	original_text: string,
	generated_text: string,
	helper_bindings: Pick<MarkupHelperBindings, "yieldable">,
): ExpressionRelocation | undefined {
	const source_file = ts.createSourceFile(
		"markup-yield-relocation.ts",
		original_text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let yield_node: ts.Node | undefined;

	collect_yield_star_nodes(source_file, (node) => {
		yield_node ??= node;
	});

	if (!yield_node || !ts.isBinaryExpression(yield_node)) {
		return undefined;
	}

	const operand = yield_node.right;
	const original_start = operand.getStart(source_file);
	const original_end = operand.end;
	const operand_text = original_text.slice(original_start, original_end).trim();
	const wrapper_text = `${helper_bindings.yieldable}(${operand_text})`;
	const wrapper_start = generated_text.indexOf(wrapper_text);

	if (wrapper_start === -1) {
		return undefined;
	}

	const generated_start = wrapper_start + wrapper_text.indexOf(operand_text);

	return {
		originalStart: original_start,
		originalEnd: original_end,
		generatedStart: generated_start,
		generatedEnd: generated_start + operand_text.length,
	};
}

function make_cache_id(candidate: MarkupCandidate): string {
	const normalized_filename = candidate.filename.replace(/[?#].*$/, "");

	return `${normalized_filename}:${candidate.start}:${candidate.end}`;
}

function make_helper_name(candidate: MarkupCandidate, name_allocator: MarkupNameAllocator): string {
	return name_allocator.reserve(`__SER___markup_effect_${candidate.start}_${candidate.end}`);
}

function make_pending_relocation(
	candidate: MarkupCandidate,
	replacement_text: string,
	expression_text: string,
	relocation: ExpressionRelocation | undefined,
): PendingRelocation | undefined {
	if (!relocation) {
		return undefined;
	}

	const generated_start = replacement_text.indexOf(expression_text);

	if (generated_start === -1) {
		return undefined;
	}

	return {
		originalStart: candidate.start + relocation.originalStart,
		originalEnd: candidate.start + relocation.originalEnd,
		generatedStartInReplacement: generated_start + relocation.generatedStart,
		generatedEndInReplacement: generated_start + relocation.generatedEnd,
	};
}
