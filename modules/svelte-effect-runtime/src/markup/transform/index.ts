import { type AST, parse } from "svelte/compiler";

import MagicString from "magic-string";

import {
  blank_script_blocks,
  create_relocations,
  create_source_map,
  inject_helpers,
  make_markup_helper_bindings,
} from "./apply.ts";
import { classify_candidates } from "./classify.ts";
import { collect_effect_callback_bindings } from "./effect-bindings.ts";
import { emit_replacements } from "./emit.ts";
import { sanitize_markup } from "./scan.ts";
import { UnsupportedMarkupEffectPositionError } from "$/errors.ts";
import type { MarkupTransformOptions, MarkupTransformResult } from "./types.ts";

export type {
  MarkupRelocation,
  MarkupTransformOptions,
  MarkupTransformResult,
  MarkupTransformTarget,
} from "./types.ts";

/**
 * Transforms Svelte markup containing `{yield* expr}` brace expressions
 * into calls to the markup runtime helpers (`value`, `promise`, `run`).
 *
 * Strategy: first find all brace expressions containing `yield*` via
 * character scanning, replace them with placeholder identifiers, then
 * parse the sanitized markup with Svelte's AST to determine the correct
 * context for each placeholder (plain expression, #each, #await, event
 * handler, etc.).
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

  const target = options.target ?? "server";

  /** Find all brace expressions containing yield* and replace with placeholders. */
  const work = sanitize_markup(content, filename);
  const effect_context = collect_effect_callback_bindings(content);
  const helper_context = make_markup_helper_bindings(content);

  if (work.candidates.length === 0) {
    return { code: content, has_yield: false };
  }

  /** Parse the sanitized markup with Svelte's AST. Strip <script> blocks
   *  first so TypeScript syntax (import type, etc.) doesn't break the parser. */
  const clean = blank_script_blocks(work.code);
  const ast = parse(clean, { filename, modern: true }) as AST.Root;

  /** Match placeholders to their AST context and build replacements. */
  const classified = classify_candidates(
    ast,
    work.candidates,
  );
  const matched = new Set(
    classified.map(({ candidate }) => candidate.placeholder),
  );
  const unmatched = work.candidates.find((candidate) =>
    !matched.has(candidate.placeholder)
  );

  if (unmatched) {
    throw new UnsupportedMarkupEffectPositionError(
      filename,
      unmatched.expr_text,
    );
  }

  const replacements = emit_replacements(
    classified,
    effect_context,
    helper_context.bindings,
    helper_context.name_allocator,
    target,
  );
  const helpers = replacements.flatMap((replacement) =>
    replacement.helpers ?? []
  );

  const magic = new MagicString(content);

  replacements.sort((a, b) => b.start - a.start);

  for (const r of replacements) {
    magic.overwrite(r.start, r.end, r.text);
  }

  const helper_insertion = inject_helpers(
    magic,
    content,
    helpers,
    helper_context.bindings,
  );
  const relocations = create_relocations(replacements, helper_insertion);

  return {
    code: magic.toString(),
    has_yield: true,
    map: create_source_map(magic, filename),
    relocations,
  };
}
