import { contains_top_level_yield_star } from "$/detect.ts";
import { TopLevelAwaitError } from "$/error.ts";

import MagicString from "magic-string";
import ts from "typescript";

import { contains_top_level_await } from "./ast.ts";
import { has_local_import_binding, make_imports } from "./imports.ts";
import { lower_statement } from "./lower.ts";
import { make_runtime_block } from "./runtime-block.ts";
import { create_source_map, slice } from "./source.ts";
import type { BlockRef, ScriptTransformResult } from "./types.ts";

export type { BlockRef, ScriptTransformResult } from "./types.ts";

/**
 * Transforms a `<script effect>` body by extracting top-level `yield*`
 * expressions into `$state` temp bindings and wrapping the lowered
 * assignments in an `Effect.gen` block that runs on mount.
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
 * @returns The transformed code and any block references.
 */
export function transform_script_effect(
  content: string,
  filename: string,
): ScriptTransformResult {
  let temp_counter = 0;

  const source_file = ts.createSourceFile(
    filename,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const magic = new MagicString(content);
  const effect_assignments: string[] = [];
  const block_refs: BlockRef[] = [];

  let has_effect = false;

  const context = {
    next_temp_name(hint?: string) {
      const suffix = temp_counter === 0 ? "" : `_${temp_counter}`;
      const name = hint ? `__SER__${hint}${suffix}` : `__SER__${temp_counter}`;

      temp_counter += 1;

      return name;
    },
  };

  /** Phase 1: detect imports already provided by the user. */
  const has_effect_import = has_local_import_binding(
    source_file,
    "effect",
    "Effect",
  );

  const has_onmount_import = has_local_import_binding(
    source_file,
    "svelte",
    "onMount",
  );

  const has_dispatcher_import = has_local_import_binding(
    source_file,
    "svelte-effect-runtime/internal/generators",
    "get_dispatcher",
  );

  /** Phase 2: lower every top-level statement that contains `yield*`. */
  for (const stmt of source_file.statements) {
    if (contains_top_level_await(stmt)) {
      const text = slice(content, stmt);
      throw new TopLevelAwaitError(filename, text);
    }

    if (!contains_top_level_yield_star(stmt)) {
      continue;
    }

    has_effect = true;
    const lowered = lower_statement(stmt, content, context);

    magic.overwrite(
      lowered.range.start,
      lowered.range.end,
      lowered.rewritten_text,
    );

    if (lowered.temps.length > 0) {
      const prefix = lowered.temps
        .map((temp) => `let ${temp.name} = $state(undefined);`)
        .join("\n");

      magic.appendLeft(lowered.range.start, prefix + "\n");
    }

    effect_assignments.push(...lowered.effect_assignments);
  }

  if (!has_effect) {
    block_refs.push({ id: filename, kind: "script" });

    return { code: content, blocks: block_refs };
  }

  /** Phase 3: inject runtime imports after the last user import. */
  const imports = make_imports(
    has_effect_import,
    has_onmount_import,
    has_dispatcher_import,
  );

  const last_import = [...source_file.statements]
    .reverse()
    .find(ts.isImportDeclaration);

  if (last_import) {
    magic.appendRight(last_import.end, "\n" + imports);
  } else {
    magic.prepend(imports + "\n");
  }

  /** Phase 4: append the runtime program and lifecycle wiring. */
  const runtime_block = make_runtime_block(effect_assignments);
  magic.append("\n" + runtime_block);

  block_refs.push({ id: filename, kind: "script" });

  return {
    code: magic.toString(),
    blocks: block_refs,
    map: create_source_map(magic, filename),
  };
}
