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

/**
 * Offset mapping between original script code and generated helper code.
 *
 * @example
 * ```ts
 * const relocation: Relocation = {
 *   originalStart: 10,
 *   originalEnd: 28,
 *   generatedStart: 64,
 *   generatedEnd: 82,
 * };
 * ```
 *
 * @since 3.2.3
 */
export interface Relocation {
	originalStart: number;
	originalEnd: number;
	generatedStart: number;
	generatedEnd: number;
}

/**
 * Internal descriptor for a single `$state` temp variable that will be
 * emitted at component scope before the rewritten statement.
 *
 * @example
 * ```ts
 * const temp: TempBinding = {
 *   name: "__SER___user",
 *   type: "Effect.Success<typeof user>",
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface TempBinding {
	name: string;
	type?: string;
}

/**
 * Describes how a single statement was lowered.
 *
 * @example
 * ```ts
 * const lowered: LoweredStatement = {
 *   temps: [],
 *   rewritten_text: "const user = __SER___dispatcher.value(...);",
 *   effect_blocks: [],
 *   range: { start: 0, end: 26 },
 * };
 * ```
 *
 * @since 2.0.0
 */
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

/**
 * Describes a generated script effect body and the identifiers it reads
 * synchronously for Svelte dependency tracking.
 *
 * @example
 * ```ts
 * const block: EffectBlock = {
 *   statements: ["const user = yield* load_user(id);"],
 *   deps: ["id"],
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface EffectBlock {
	/** Statements to emit inside the generated `Effect.gen` body. */
	statements: string[];
	/** Identifier reads that should rerun this block when they change. */
	deps: string[];
}

/**
 * Describes how a single expression was lowered.
 *
 * @example
 * ```ts
 * const expression: LoweredExpression = {
 *   temps: [],
 *   rewritten_expr: "__SER___dispatcher.value(...)",
 *   effect_blocks: [],
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface LoweredExpression {
	temps: TempBinding[];
	type_helpers?: string[];
	rewritten_expr: string;
	effect_blocks: EffectBlock[];
}

/**
 * Stateful services used while lowering one script block.
 *
 * @example
 * ```ts
 * const context: ScriptLoweringContext = {
 *   filename: "App.svelte",
 *   dispatcher_name: "get_dispatcher",
 *   effect_name: "Effect",
 *   emit_types: true,
 *   next_helper_name: (hint = "helper") => hint,
 *   next_temp_name: (hint = "temp") => hint,
 *   next_type_helper_name: (hint = "type") => hint,
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface ScriptLoweringContext {
	/** Source filename used for stable generated runtime ids. */
	filename: string;
	/** Binding name used for the dispatcher factory in generated code. */
	dispatcher_name: string;
	/** Binding name used for the Effect namespace in generated code. */
	effect_name: string;
	/** Whether generated state placeholders should carry TypeScript types. */
	emit_types: boolean;
	/**
	 * Reserves a generated helper identifier.
	 *
	 * @param hint - Optional readable stem for the generated identifier.
	 * @returns A collision-free helper identifier.
	 */
	next_helper_name(hint?: string): string;
	/**
	 * Reserves a generated `$state` temporary identifier.
	 *
	 * @param hint - Optional readable stem for the generated identifier.
	 * @returns A collision-free temporary identifier.
	 */
	next_temp_name(hint?: string): string;
	/**
	 * Reserves a generated type-helper identifier.
	 *
	 * @param hint - Optional readable stem for the generated identifier.
	 * @returns A collision-free type-helper identifier.
	 */
	next_type_helper_name(hint?: string): string;
}

/**
 * Runtime import bindings selected for generated script effect code.
 *
 * @example
 * ```ts
 * const bindings: RuntimeImportBindings = {
 *   effect: "Effect",
 *   dispatcher: "get_dispatcher",
 *   dispatcher_value: "__SER___dispatcher",
 *   program: "__SER___program",
 *   cancel: "__SER___cancel",
 *   untrack: "untrack",
 * };
 * ```
 *
 * @since 2.4.2
 */
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
}
