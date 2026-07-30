import type {
	BlockRef,
	EffectBlock,
	Relocation,
	RuntimeImportBindings,
	ScriptLoweringContext,
	ScriptTransformResult,
} from "./types.ts";
import {
	collect_top_level_binding_names,
	has_local_import_binding,
	make_imports,
} from "./imports.ts";
import { collect_yield_star_nodes, contains_top_level_await } from "./ast.ts";
import { AwaitInEffectWorkError, PreprocessError } from "$/errors.ts";
import { make_runtime_block_with_bindings } from "./runtime-block.ts";
import { contains_top_level_yield_star } from "$/detect.ts";
import { create_source_map, slice } from "./source.ts";
import { validate_rune_yield_usage } from "./runes.ts";
import { lower_statement } from "./lower.ts";
import type { MarkupTransformTarget } from "$/markup/transform.ts";

import MagicString from "magic-string";
import ts from "typescript";

export type { BlockRef, ScriptTransformResult } from "./types.ts";

interface ScriptTransformOptions {
	emit_types?: boolean;
	target?: MarkupTransformTarget;
}

/**
 * Transforms a `<script effect>` body by lowering top-level `yield*`
 * expressions into Svelte-compatible async rendering declarations or into
 * dependency-tracked `$effect` blocks for effectful statements.
 *
 * @example
 * ```ts
 * const result = transform_script_effect(
 *   `let user = $state(yield* getUser(id));`,
 *   "App.svelte",
 * );
 * ```
 *
 * @since 2.0.0
 * @param content - The raw `<script effect>` body content.
 * @param filename - The source filename, used in error messages.
 * @param options - Optional transform settings for generated script code.
 * @returns The transformed code and any block references.
 */
export function transform_script_effect(
	content: string,
	filename: string,
	options: ScriptTransformOptions = {},
): ScriptTransformResult {
	let temp_counter = 0;
	const target = options.target ?? "client";

	const source_file = ts.createSourceFile(
		filename,
		content,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);

	const magic = new MagicString(content);
	const effect_blocks: EffectBlock[] = [];
	const block_refs: BlockRef[] = [];
	const top_level_binding_names = collect_top_level_binding_names(source_file);
	const top_level_binding_names_set = new Set(top_level_binding_names);
	const name_allocator = make_name_allocator(top_level_binding_names);
	const emit_types = options.emit_types ?? true;

	let has_effect = false;
	let first_effect_statement_start = content.length;
	let uses_dispatcher_promise = false;
	let uses_yield_success_types = false;

	/** Phase 1: detect imports already provided by the user. */
	const has_effect_import = has_local_import_binding(source_file, "effect", "Effect");

	const has_dispatcher_import = has_local_import_binding(
		source_file,
		"svelte-effect-runtime/internal/generators",
		"get_dispatcher",
	);

	const has_untrack_import = has_local_import_binding(source_file, "svelte", "untrack");
	const has_on_destroy_import = has_local_import_binding(
		source_file,
		"svelte",
		"onDestroy",
		false,
	);

	const reserve_runtime_import = (name: string) =>
		top_level_binding_names_set.has(name)
			? name_allocator.reserve(make_generated_name(name, ""))
			: name_allocator.reserve(name);

	const runtime_bindings: RuntimeImportBindings = {
		cancel: name_allocator.reserve("__SER___cancel"),
		component_scope_ref: reserve_runtime_import("ComponentScopeRef"),
		dispatcher: has_dispatcher_import
			? "get_dispatcher"
			: reserve_runtime_import("get_dispatcher"),
		dispatcher_value: name_allocator.reserve("__SER___dispatcher"),
		effect: has_effect_import ? "Effect" : reserve_runtime_import("Effect"),
		on_destroy: has_on_destroy_import ? "onDestroy" : reserve_runtime_import("onDestroy"),
		program: name_allocator.reserve("__SER___program"),
		scope: name_allocator.reserve("__SER___scope"),
		untrack: has_untrack_import ? "untrack" : reserve_runtime_import("untrack"),
		yield_success: reserve_runtime_import("YieldSuccess"),
		yieldable: reserve_runtime_import("ToEffect"),
	};

	const context: ScriptLoweringContext = {
		filename,
		dispatcher_name: runtime_bindings.dispatcher,
		scope_name: runtime_bindings.scope,
		effect_name: runtime_bindings.effect,
		emit_types,
		yield_success_name: runtime_bindings.yield_success,
		yieldable_name: runtime_bindings.yieldable,
		next_helper_name(hint?: string) {
			return name_allocator.reserve(make_generated_name(hint ?? "helper", ""));
		},
		next_temp_name(hint?: string) {
			const suffix = temp_counter === 0 ? "" : `_${temp_counter}`;
			const name = make_generated_name(hint ?? String(temp_counter), suffix);

			temp_counter += 1;

			return name_allocator.reserve(name);
		},
		next_type_helper_name(hint?: string) {
			return name_allocator.reserve(make_generated_name(`type_${hint ?? "effect"}`, ""));
		},
	};

	/** Phase 2: lower every top-level statement that contains `yield*`. */
	for (const stmt of source_file.statements) {
		validate_rune_yield_usage(stmt, content, filename);
		validate_script_yield_boundaries(stmt, content, filename);

		const has_top_level_yield_star = contains_top_level_yield_star(stmt);

		if (!has_top_level_yield_star) {
			continue;
		}

		has_effect = true;

		const lowered = lower_statement(stmt, content, context);

		first_effect_statement_start = Math.min(first_effect_statement_start, lowered.range.start);

		if (lowered.effect_blocks.length > 0 && contains_top_level_await(stmt)) {
			const text = slice(content, stmt);
			throw new AwaitInEffectWorkError(filename, text);
		}

		magic.overwrite(lowered.range.start, lowered.range.end, lowered.rewritten_text);

		if (lowered.temps.length > 0 || lowered.type_helpers?.length) {
			const temp_declarations = lowered.temps.map((temp) =>
				temp.type
					? `let ${temp.name} = $state<${temp.type}>(undefined);`
					: `let ${temp.name} = $state(undefined);`,
			);

			const prefix = [...(lowered.type_helpers ?? []), ...temp_declarations].join("\n");

			magic.appendLeft(lowered.range.start, prefix + "\n");
		}

		effect_blocks.push(...lowered.effect_blocks);
		uses_dispatcher_promise ||= lowered.uses_dispatcher_promise ?? false;
		uses_yield_success_types ||= lowered.temps.some(
			(temp) => temp.type?.includes(runtime_bindings.yield_success) ?? false,
		);
	}

	if (!has_effect) {
		block_refs.push({ id: filename, kind: "script" });

		return { code: content, blocks: block_refs };
	}

	/** Phase 3: inject runtime imports after the last user import. */
	const imports = make_imports(
		has_effect_import,
		has_dispatcher_import,
		has_untrack_import,
		has_on_destroy_import,
		runtime_bindings,
		{
			needs_dispatcher: effect_blocks.length > 0 || uses_dispatcher_promise,
			needs_effect: effect_blocks.length > 0,
			needs_untrack: effect_blocks.length > 0,
			needs_on_destroy: true,
			needs_yield_success: uses_yield_success_types,
			needs_yieldable: effect_blocks.length > 0 || uses_dispatcher_promise,
			needs_scope_ref: true,
		},
	);

	const last_import = [...source_file.statements].reverse().find(ts.isImportDeclaration);
	const injection_point = last_import
		? Math.min(last_import.end, first_effect_statement_start)
		: first_effect_statement_start;

	/**
	 * The scope holder is created synchronously with the imports so it exists
	 * before any top-level `await`, and disposal is registered through
	 * `onDestroy` during component initialisation. Emitting both here keeps
	 * them ahead of every lowered statement that references the scope.
	 */
	const scope_wiring = [
		`const ${runtime_bindings.scope} = new ${runtime_bindings.component_scope_ref}(${runtime_bindings.dispatcher});`,
		...(target === "server"
			? []
			: [`${runtime_bindings.on_destroy}(() => ${runtime_bindings.scope}.dispose());`]),
	].join("\n");

	const injected = [imports, scope_wiring].filter(Boolean).join("\n");

	if (last_import && last_import.end <= first_effect_statement_start) {
		magic.appendRight(last_import.end, "\n" + injected);
	} else if (injection_point >= 0) {
		magic.appendLeft(injection_point, injected + "\n");
	} else {
		magic.appendLeft(first_effect_statement_start, injected + "\n");
	}

	/** Phase 4: append the runtime program blocks. */

	if (effect_blocks.length > 0) {
		const runtime_block = make_runtime_block_with_bindings(effect_blocks, runtime_bindings);

		magic.append("\n" + runtime_block);
	}

	block_refs.push({ id: filename, kind: "script" });

	const code = magic.toString();

	return {
		code,
		blocks: block_refs,
		map: create_source_map(magic, filename),
		relocations: create_script_relocations(
			content,
			code,
			source_file,
			runtime_bindings.yieldable,
		),
	};
}

function create_script_relocations(
	content: string,
	code: string,
	source_file: ts.SourceFile,
	yieldable_name: string,
): Relocation[] {
	const candidates = source_file.statements.flatMap((stmt) => {
		const relocations: RelocationCandidate[] = [];

		if (contains_top_level_yield_star(stmt) && ts.isVariableStatement(stmt)) {
			for (const decl of stmt.declarationList.declarations) {
				collect_binding_relocation_candidates(decl.name, relocations);
			}
		}

		collect_yield_star_nodes(stmt, (node) => {
			const expression = ts.isBinaryExpression(node) ? node.right : node;
			const text = content.slice(expression.getStart(), expression.end).trim();

			relocations.push({
				originalStart: expression.getStart(),
				originalEnd: expression.end,
				text,
				match: "yield_operand",
				wrapper: `${yieldable_name}(${text})`,
			});
		});

		return relocations;
	});

	const used_ranges: Array<{ start: number; end: number }> = [];
	const search_cursors = new Map<string, number>();

	return candidates.flatMap((candidate) => {
		const search_key = make_relocation_search_key(candidate);
		const generated_start = find_available_generated_text(
			code,
			candidate,
			used_ranges,
			search_cursors.get(search_key) ?? 0,
		);

		if (generated_start < 0) {
			search_cursors.set(search_key, code.length);

			return [];
		}

		const generated_end = generated_start + candidate.text.length;
		used_ranges.push({ start: generated_start, end: generated_end });
		search_cursors.set(search_key, generated_end);

		return [
			{
				originalStart: candidate.originalStart,
				originalEnd: candidate.originalEnd,
				generatedStart: generated_start,
				generatedEnd: generated_end,
			},
		];
	});
}

type RelocationCandidate = {
	originalStart: number;
	originalEnd: number;
	text: string;
	match: "exact" | "identifier" | "yield_operand";
	wrapper?: string;
};

function make_relocation_search_key(candidate: RelocationCandidate): string {
	return `${candidate.match}:${candidate.text}`;
}

function collect_binding_relocation_candidates(
	name: ts.BindingName,
	candidates: RelocationCandidate[],
): void {
	if (ts.isIdentifier(name)) {
		candidates.push({
			originalStart: name.getStart(),
			originalEnd: name.end,
			text: name.text,
			match: "identifier",
		});

		return;
	}

	for (const element of name.elements) {
		if (ts.isOmittedExpression(element)) {
			continue;
		}

		collect_binding_relocation_candidates(element.name, candidates);
	}
}

function find_available_generated_text(
	code: string,
	candidate: RelocationCandidate,
	used_ranges: Array<{ start: number; end: number }>,
	search_start: number,
): number {
	while (search_start < code.length) {
		const search_text =
			candidate.match === "yield_operand" ? candidate.wrapper : candidate.text;

		if (!search_text) {
			return -1;
		}

		const index = code.indexOf(search_text, search_start);

		if (index < 0) {
			return -1;
		}

		const operand_offset =
			candidate.match === "yield_operand" && candidate.wrapper
				? candidate.wrapper.indexOf(candidate.text)
				: 0;
		const start = index + Math.max(operand_offset, 0);
		const end = start + candidate.text.length;
		const overlaps_used_range = used_ranges.some(
			(range) => start < range.end && end > range.start,
		);
		const is_text_match =
			candidate.match !== "identifier" || is_identifier_text_match(code, start, end);

		if (!overlaps_used_range && is_text_match) {
			return start;
		}

		search_start = candidate.match === "identifier" ? index + 1 : index + search_text.length;
	}

	return -1;
}

function is_identifier_text_match(code: string, start: number, end: number): boolean {
	const before = start === 0 ? 0 : code.charCodeAt(start - 1);
	const after = end >= code.length ? 0 : code.charCodeAt(end);

	return !is_identifier_part(before) && !is_identifier_part(after);
}

function is_identifier_part(char_code: number): boolean {
	return (
		(char_code >= 65 && char_code <= 90) ||
		(char_code >= 97 && char_code <= 122) ||
		(char_code >= 48 && char_code <= 57) ||
		char_code === 36 ||
		char_code === 95
	);
}

function validate_script_yield_boundaries(
	stmt: ts.Statement,
	content: string,
	filename: string,
): void {
	const bad_member = find_class_member_with_yield_star(stmt);

	if (!bad_member) {
		return;
	}

	throw new PreprocessError(
		[
			`[ASYNC_EFFECT_IN_CLASS_MEMBER]: ${filename}: yield* cannot be used inside class members.`,
			`Class fields and methods are not component top-level reactive work. Move the Effect work into a script effect statement before assigning it to the class instance.`,
			"",
			"Problematic member:",
			slice(content, bad_member),
		].join("\n"),
		filename,
	);
}

function find_class_member_with_yield_star(stmt: ts.Statement): ts.Node | undefined {
	let found: ts.Node | undefined;

	function visit(node: ts.Node): void {
		if (found) {
			return;
		}

		if (
			ts.isPropertyDeclaration(node) &&
			node.initializer &&
			contains_top_level_yield_star(node.initializer)
		) {
			found = node;
			return;
		}

		node.forEachChild(visit);
	}

	visit(stmt);

	return found;
}

function make_name_allocator(initial_names: readonly string[]): {
	reserve(name: string): string;
} {
	const used_names = new Set(initial_names);

	return {
		reserve(name: string): string {
			let candidate = name;
			let suffix = 1;

			while (used_names.has(candidate)) {
				candidate = `${name}_${suffix}`;
				suffix += 1;
			}

			used_names.add(candidate);

			return candidate;
		},
	};
}

function make_generated_name(hint: string, suffix: string): string {
	const normalized_hint = hint.replace(/[^A-Za-z0-9_$]/g, "_");
	const safe_hint = /^[A-Za-z_$]/.test(normalized_hint)
		? normalized_hint
		: `temp_${normalized_hint}`;

	return `__SER___${safe_hint}${suffix}`;
}
