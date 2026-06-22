/**
 * Block reference emitted by the preprocessor to track what blocks were
 * generated in a given file.
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
 * Result of the script preprocessor pass.
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
}

/**
 * Internal descriptor for a single `$state` temp variable that will be
 * emitted at component scope before the rewritten statement.
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
 * @since 2.0.0
 */
export interface LoweredStatement {
  /** `$state` bindings to emit at component scope. */
  temps: TempBinding[];
  /** Helper declarations to emit before the rewritten statement. */
  type_helpers?: string[];
  /** Whether the rewritten statement directly awaits a dispatcher promise. */
  uses_dispatcher_promise?: boolean;
  /** The rewritten statement text with yield* replaced by temp refs. */
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
 * @since 2.0.0
 */
export interface ScriptLoweringContext {
  /** Source filename used for stable generated runtime ids. */
  filename: string;
  /** Binding name used for the dispatcher factory in generated code. */
  dispatcher_name: string;
  effect_name: string;
  /** Whether generated state placeholders should carry TypeScript types. */
  emit_types: boolean;
  next_helper_name(hint?: string): string;
  next_temp_name(hint?: string): string;
  next_type_helper_name(hint?: string): string;
}

/**
 * Runtime import bindings selected for generated script effect code.
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
