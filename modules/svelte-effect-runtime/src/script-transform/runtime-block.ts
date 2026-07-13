import type { EffectBlock, RuntimeImportBindings } from "./types.ts";

/**
 * Builds the runtime blocks appended to lowered script effect code with
 * explicit runtime import bindings.
 *
 * @example
 * ```ts
 * const runtime_code = make_runtime_block_with_bindings(blocks, bindings);
 * ```
 *
 * @since 2.4.2
 * @param blocks - Effect bodies and dependency reads to emit.
 * @param bindings - Runtime binding names available in the generated code.
 * @returns Full `$effect` blocks that fork generated `Effect.gen` programs.
 */
export function make_runtime_block_with_bindings(
	blocks: EffectBlock[],
	bindings: RuntimeImportBindings,
): string {
	return blocks.map((block) => make_runtime_effect_block(block, bindings)).join("\n");
}

function make_runtime_effect_block(block: EffectBlock, bindings: RuntimeImportBindings): string {
	const dep_reads = block.deps.map((dep) => `  ${dep};`);

	const body = block.statements.map((statement) => `    ${statement}`).join("\n");

	return [
		"",
		"$effect(() => {",
		...dep_reads,
		`  const ${bindings.dispatcher_value} = ${bindings.dispatcher}();`,
		`  const ${bindings.program} = ${bindings.effect}.gen(function* () {`,
		body,
		"  });",
		`  const ${bindings.cancel} = ${bindings.untrack}(() => ${bindings.dispatcher_value}.fork(${bindings.program}));`,
		`  import.meta.hot?.dispose(${bindings.cancel});`,
		`  return ${bindings.cancel};`,
		"});",
		"",
	].join("\n");
}
