import ts from "typescript";

/**
 * Describes a single yield* extraction from an expression.
 *
 * @since 2.0.0
 */
export interface Extraction {
  /** The name of the `$state` temp variable that holds the intermediate result. */
  temp_name: string;
  /** The text of the yield* operand (e.g. `getUser(id)` from `yield* getUser(id)`). */
  yield_target: string;
  /** Character offset where the yield* expression starts in the source. */
  yield_start: number;
  /** Character offset where the yield* expression ends in the source. */
  yield_end: number;
}

/**
 * Extracts every top-level `yield*` sub-expression from the given expression
 * node, returning descriptions of what to lower.
 *
 * @example
 * ```ts
 * const sf = ts.createSourceFile("t.ts", "$state(yield* f())", ...);
 * const result = extractYieldStars(sf.statements[0].expression, "file.ts");
 * // result has one Extraction { temp_name: "__SER__0", yield_target: "f()" }
 * ```
 *
 * @since 2.0.0
 * @param expression - The root expression to scan.
 * @param filename - The source filename, used in error messages.
 * @returns Array of extractions found, or empty if none.
 */
export function extractYieldStars(
  _expression: ts.Expression,
  _filename: string,
): readonly Extraction[] {
  throw new Error("not implemented yet");
}
