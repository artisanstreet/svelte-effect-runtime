import {
	create_relocations,
	create_source_map,
	inject_helpers,
	make_markup_helper_bindings,
} from "./apply.ts";
import type { MarkupTransformOptions, MarkupTransformResult } from "./types.ts";
import { collect_effect_callback_bindings } from "./effect-bindings.ts";
import { scan_svelte_effect_source } from "$/compiler/source-scan.ts";
import { UnsupportedMarkupEffectPositionError } from "$/errors.ts";
import { classify_candidates } from "./classify.ts";
import { type AST, parse } from "svelte/compiler";
import { emit_replacements } from "./emit.ts";
import { sanitize_markup } from "./scan.ts";

import MagicString from "magic-string";

export type {
	MarkupRelocation,
	MarkupTransformOptions,
	MarkupTransformResult,
	MarkupTransformTarget,
} from "./types.ts";

/**
 * Transforms Svelte markup containing `{yield* expr}` brace expressions
 * into generated dispatcher events.
 *
 * Strategy: first find all brace expressions containing `yield*` via
 * character scanning, replace them with placeholder identifiers, then
 * parse the sanitized markup with Svelte's AST to determine the correct
 * context for each placeholder (plain expression, #each, #await, event
 * handler, etc.).
 *
 * @example
 * ```ts
 * const result = transform_markup_effect(
 *   "<button onclick={yield* save()}>Save</button>",
 *   "SaveButton.svelte",
 * );
 * ```
 *
 * @since 2.0.0
 * @param content - The raw `.svelte` file content.
 * @param filename - The source filename, used in error messages.
 * @param options - Optional transform target configuration.
 * @returns The transformed markup and a flag indicating whether yield* was
 *   found.
 */
export function transform_markup_effect(
	content: string,
	filename: string,
	options: MarkupTransformOptions = {},
): MarkupTransformResult {
	if (!/\byield\s*\*/.test(content)) {
		return { code: content, has_yield: false };
	}

	const source_scan = scan_svelte_effect_source(content, filename);

	/** Find all brace expressions containing yield* and replace with placeholders. */
	const work = sanitize_markup(source_scan);

	if (work.candidates.length === 0) {
		return { code: content, has_yield: false };
	}

	const effect_context = collect_effect_callback_bindings(source_scan.scripts);
	const helper_context = make_markup_helper_bindings(source_scan, options.target ?? "client");

	/** Parse the sanitized markup with Svelte's AST. */
	const ast = parse(work.parse_code, { filename, modern: true }) as AST.Root;

	/** Match placeholders to their AST context and build replacements. */
	const classified = classify_candidates(ast, work.candidates);
	const matched = new Set(classified.map(({ candidate }) => candidate.placeholder));
	const unmatched = work.candidates.find((candidate) => !matched.has(candidate.placeholder));

	if (unmatched) {
		throw new UnsupportedMarkupEffectPositionError(filename, unmatched.expr_text);
	}

	const replacements = emit_replacements(
		classified,
		effect_context,
		helper_context.bindings,
		helper_context.name_allocator,
		options.target ?? "client",
	);
	const helpers = replacements.flatMap((replacement) => replacement.helpers ?? []);

	const magic = new MagicString(content);

	replacements.sort((a, b) => b.start - a.start);

	for (const r of replacements) {
		magic.overwrite(r.start, r.end, r.text);
	}

	const helper_insertion = inject_helpers(
		magic,
		source_scan,
		helpers,
		helper_context.bindings,
		helper_context.scope_wiring,
	);
	const relocations = create_relocations(replacements, helper_insertion);

	return {
		code: magic.toString(),
		has_yield: true,
		map: create_source_map(magic, filename),
		relocations,
	};
}
