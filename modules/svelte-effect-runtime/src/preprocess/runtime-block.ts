import type { EffectBlock } from "./types.ts";

/**
 * Builds the runtime blocks appended to lowered script effect code.
 *
 * @since 2.0.0
 * @param blocks - Effect bodies and dependency reads to emit.
 * @returns Full `$effect` blocks that fork generated `Effect.gen` programs.
 */
export function make_runtime_block(blocks: EffectBlock[]): string {
  const merged_block = merge_effect_blocks(blocks);
  const dep_reads = merged_block.deps.map((dep) => `  ${dep};`);

  const body = merged_block.statements
    .map((statement) => `    ${statement}`)
    .join("\n");

  return [
    "",
    "$effect(() => {",
    ...dep_reads,
    "  const __SER___dispatcher = get_dispatcher();",
    "  const __SER___program = Effect.gen(function* () {",
    body,
    "  });",
    "  const __SER___cancel = untrack(() => __SER___dispatcher.fork(__SER___program));",
    "  import.meta.hot?.dispose(__SER___cancel);",
    "  return __SER___cancel;",
    "});",
    "",
  ].join("\n");
}

function merge_effect_blocks(blocks: EffectBlock[]): EffectBlock {
  const statements = blocks.flatMap((block) => block.statements);
  const deps = blocks.flatMap((block) => block.deps);

  return {
    statements,
    deps: [...new Set(deps)],
  };
}
