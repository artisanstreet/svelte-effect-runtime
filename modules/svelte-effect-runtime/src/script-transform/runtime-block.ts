import type { EffectBlock, RuntimeImportBindings } from "./types.ts";

/**
 * Builds the runtime blocks appended to lowered script effect code.
 *
 * @since 2.0.0
 * @param blocks - Effect bodies and dependency reads to emit.
 * @returns Full `$effect` blocks that fork generated `Effect.gen` programs.
 */
export function make_runtime_block(blocks: EffectBlock[]): string {
	const bindings: RuntimeImportBindings = {
		cancel: "__SER___cancel",
		dispatcher: "get_dispatcher",
		dispatcher_value: "__SER___dispatcher",
		effect: "Effect",
		program: "__SER___program",
		untrack: "untrack",
	};

	return make_runtime_block_with_bindings(blocks, bindings);
}

/**
 * Builds the runtime blocks appended to lowered script effect code with
 * explicit runtime import bindings.
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
	const merged_block = merge_effect_blocks(blocks);
	const dep_reads = merged_block.deps.map((dep) => `  ${dep};`);

	const body = merged_block.statements.map((statement) => `    ${statement}`).join("\n");

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

function merge_effect_blocks(blocks: EffectBlock[]): EffectBlock {
	const statements = blocks.flatMap((block) => block.statements);
	const deps = blocks.flatMap((block) => block.deps);

	return {
		statements,
		deps: [...new Set(deps)],
	};
}
