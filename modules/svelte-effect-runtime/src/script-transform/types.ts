/**
 * Block reference emitted by the script transform to track what blocks were
 * generated in a given file.
 *
 * @example
 * ```ts
 * const block: BlockRef = {
 *   id: "App.svelte",
 *   kind: "script",
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface BlockRef {
	/** Stable identifier for this block, used for cache lookups. */
	id: string;
	/** What kind of block was emitted. */
	kind: "value" | "promise" | "run" | "script";
}

/**
 * Result of the script transform pass.
 *
 * @example
 * ```ts
 * const result: ScriptTransformResult = {
 *   code: "const value = __SER___dispatcher.value(...);",
 *   blocks: [{ id: "App.svelte", kind: "script" }],
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface ScriptTransformResult {
	/** The transformed source code. */
	code: string;
	/** Block references emitted during transformation. */
	blocks: BlockRef[];
	/** Source map from transformed code back to the original script block. */
	map?: Record<string, unknown>;
	/** Offset ranges that preserve hoverable moved source spans. */
	relocations?: Relocation[];
}

export interface Relocation {
	originalStart: number;
	originalEnd: number;
	generatedStart: number;
	generatedEnd: number;
}

export interface TempBinding {
	name: string;
	type?: string;
}

export interface LoweredStatement {
	/** `$state` bindings to emit at component scope. */
	temps: TempBinding[];
	/** Helper declarations to emit before the rewritten statement. */
	type_helpers?: string[];
	/** Whether the rewritten statement directly awaits a dispatcher promise. */
	uses_dispatcher_promise?: boolean;
	/** The rewritten statement text with yield* lowered into runtime helpers. */
	rewritten_text: string;
	/** Effect bodies to emit in dependency-tracked runtime blocks. */
	effect_blocks: EffectBlock[];
	/** Original statement range to replace in the source. */
	range: { start: number; end: number };
}

export interface EffectBlock {
	/** Statements to emit inside the generated `Effect.gen` body. */
	statements: string[];
	/** Identifier reads that should rerun this block when they change. */
	deps: string[];
}

export interface LoweredExpression {
	temps: TempBinding[];
	type_helpers: string[];
	rewritten_expr: string;
	effect_blocks: EffectBlock[];
}

export interface ScriptLoweringContext {
	/** Source filename used for stable generated runtime ids. */
	filename: string;
	/** Binding name used for the dispatcher factory in generated code. */
	dispatcher_name: string;
	/** Binding name used for the Effect namespace in generated code. */
	effect_name: string;
	/** Binding name used for the yieldable normalization helper. */
	yieldable_name: string;
	/** Binding name used for yieldable success type extraction. */
	yield_success_name: string;
	/** Whether generated state placeholders should carry TypeScript types. */
	emit_types: boolean;
	next_helper_name(hint?: string): string;
	next_temp_name(hint?: string): string;
	next_type_helper_name(hint?: string): string;
}

export interface RuntimeImportBindings {
	/** Binding name used for the Effect namespace in generated code. */
	effect: string;
	/** Binding name used for the dispatcher factory in generated code. */
	dispatcher: string;
	/** Binding name used for the active dispatcher local. */
	dispatcher_value: string;
	/** Binding name used for the generated Effect program local. */
	program: string;
	/** Binding name used for the generated cancel function local. */
	cancel: string;
	/** Binding name used for Svelte's untrack helper. */
	untrack: string;
	/** Binding name used for Svelte's onDestroy lifecycle hook. */
	on_destroy: string;
	/** Binding name used for the component's Effect scope local. */
	scope: string;
	/** Binding name used for the yieldable normalization helper. */
	yieldable: string;
	/** Binding name used for yieldable success type extraction. */
	yield_success: string;
}
