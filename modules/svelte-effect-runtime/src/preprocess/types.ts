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
}

/**
 * Describes how a single statement was lowered.
 *
 * @since 2.0.0
 */
export interface LoweredStatement {
  /** `$state` bindings to emit at component scope. */
  temps: TempBinding[];
  /** The rewritten statement text with yield* replaced by temp refs. */
  rewritten_text: string;
  /** The assignments to emit in the effect body (includes `yield*`). */
  effect_assignments: string[];
  /** Original statement range to replace in the source. */
  range: { start: number; end: number };
}

/**
 * Describes how a single expression was lowered.
 *
 * @since 2.0.0
 */
export interface LoweredExpression {
  temps: TempBinding[];
  rewritten_expr: string;
  effect_assignments: string[];
}

/**
 * Stateful services used while lowering one script block.
 *
 * @since 2.0.0
 */
export interface ScriptLoweringContext {
  next_temp_name(hint?: string): string;
}
