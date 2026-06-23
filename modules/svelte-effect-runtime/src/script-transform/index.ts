import { contains_top_level_yield_star } from "$/detect.ts";
import {
  collect_top_level_binding_names,
  has_local_import_binding,
  make_imports,
} from "./imports.ts";
import { create_source_map, slice } from "./source.ts";
import { AwaitInEffectWorkError, PreprocessError } from "$/errors.ts";
import { make_runtime_block_with_bindings } from "./runtime-block.ts";
import { contains_top_level_await } from "./ast.ts";
import { lower_statement } from "./lower.ts";
import { validate_rune_yield_usage } from "./runes.ts";
import type {
  BlockRef,
  EffectBlock,
  RuntimeImportBindings,
  ScriptLoweringContext,
  ScriptTransformResult,
} from "./types.ts";

import MagicString from "magic-string";
import ts from "typescript";

export type { BlockRef, ScriptTransformResult } from "./types.ts";

interface ScriptTransformOptions {
  emit_types?: boolean;
}

/**
 * Transforms a `<script effect>` body by extracting top-level `yield*`
 * expressions into `$state` temp bindings and wrapping the lowered
 * assignments in a dependency-tracked `$effect` block.
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
  let uses_dispatcher_promise = false;
  let uses_effect_types = false;

  /** Phase 1: detect imports already provided by the user. */
  const has_effect_import = has_local_import_binding(
    source_file,
    "effect",
    "Effect",
  );

  const has_dispatcher_import = has_local_import_binding(
    source_file,
    "svelte-effect-runtime/internal/generators",
    "get_dispatcher",
  );

  const has_untrack_import = has_local_import_binding(
    source_file,
    "svelte",
    "untrack",
  );

  const reserve_runtime_import = (name: string) =>
    top_level_binding_names_set.has(name)
      ? name_allocator.reserve(make_generated_name(name, ""))
      : name_allocator.reserve(name);

  const runtime_bindings: RuntimeImportBindings = {
    cancel: name_allocator.reserve("__SER___cancel"),
    dispatcher: has_dispatcher_import
      ? "get_dispatcher"
      : reserve_runtime_import("get_dispatcher"),
    dispatcher_value: name_allocator.reserve("__SER___dispatcher"),
    effect: has_effect_import ? "Effect" : reserve_runtime_import("Effect"),
    program: name_allocator.reserve("__SER___program"),
    untrack: has_untrack_import ? "untrack" : reserve_runtime_import("untrack"),
  };

  const context: ScriptLoweringContext = {
    filename,
    dispatcher_name: runtime_bindings.dispatcher,
    effect_name: runtime_bindings.effect,
    emit_types,
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
      return name_allocator.reserve(
        make_generated_name(`type_${hint ?? "effect"}`, ""),
      );
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

    if (contains_top_level_await(stmt)) {
      const text = slice(content, stmt);
      throw new AwaitInEffectWorkError(filename, text);
    }

    has_effect = true;
    const lowered = lower_statement(stmt, content, context);

    magic.overwrite(
      lowered.range.start,
      lowered.range.end,
      lowered.rewritten_text,
    );

    if (lowered.temps.length > 0 || lowered.type_helpers?.length) {
      const temp_declarations = lowered.temps.map((temp) =>
        temp.type
          ? `let ${temp.name} = $state<${temp.type}>(undefined);`
          : `let ${temp.name} = $state(undefined);`
      );

      const prefix = [
        ...(lowered.type_helpers ?? []),
        ...temp_declarations,
      ].join("\n");

      magic.appendLeft(lowered.range.start, prefix + "\n");
    }

    effect_blocks.push(...lowered.effect_blocks);
    uses_dispatcher_promise ||= lowered.uses_dispatcher_promise ?? false;
    uses_effect_types ||= lowered.temps.some((temp) =>
      temp.type?.includes(`${runtime_bindings.effect}.Success`) ?? false
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
    runtime_bindings,
    {
      needs_dispatcher: effect_blocks.length > 0 || uses_dispatcher_promise,
      needs_effect: effect_blocks.length > 0 || uses_effect_types,
      needs_untrack: effect_blocks.length > 0,
    },
  );

  const last_import = [...source_file.statements]
    .reverse()
    .find(ts.isImportDeclaration);

  if (imports) {
    if (last_import) {
      magic.appendRight(last_import.end, "\n" + imports);
    } else {
      magic.prepend(imports + "\n");
    }
  }

  /** Phase 4: append the runtime program and lifecycle wiring. */
  if (effect_blocks.length > 0) {
    const runtime_block = make_runtime_block_with_bindings(
      effect_blocks,
      runtime_bindings,
    );

    magic.append("\n" + runtime_block);
  }

  block_refs.push({ id: filename, kind: "script" });

  return {
    code: magic.toString(),
    blocks: block_refs,
    map: create_source_map(magic, filename),
  };
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

function find_class_member_with_yield_star(
  stmt: ts.Statement,
): ts.Node | undefined {
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
