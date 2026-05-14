import ts from "typescript";

/**
 * Describes a single `yield*` expression extracted from a larger expression,
 * ready to be lowered into a `$state` temp binding and an effect-body
 * assignment.
 *
 * @since 2.0.0
 */
export interface Extraction {
  /**
   * The name of the `$state` temp variable that holds the intermediate result.
   * Follows the `__SER__` prefix convention, e.g. `__SER__user`.
   */
  temp_name: string;
  /**
   * The text of the yield* operand after stripping the `yield*` keyword.
   * E.g. `getUser(id)` extracted from `yield* getUser(id)`.
   */
  yield_target: string;
  /** Character offset where the `yield*` expression starts in the original source. */
  yield_start: number;
  /** Character offset where the `yield*` expression ends in the original source. */
  yield_end: number;
}

/**
 * Walks the TypeScript AST of an expression and extracts every top-level
 * `yield*` sub-expression that sits outside any function boundary. Each
 * extraction describes the yield target and its source position so the
 * preprocessor can replace it with a `$state` temp reference.
 *
 * @example
 * ```ts
 * const sf = ts.createSourceFile("t.ts", "$state(yield* f())", ...);
 * const result = extract_yield_stars(sf.statements[0].expression, "file.ts");
 * result.length === 1;
 * result[0].temp_name === "__SER__0";
 * result[0].yield_target === "f()";
 * ```
 *
 * @since 2.0.0
 * @param expression - The root expression to scan.
 * @param filename - The source filename, used in error messages.
 * @returns Array of extractions found, or empty if none.
 */
export function extract_yield_stars(
  _expression: ts.Expression,
  _filename: string,
): readonly Extraction[] {
  throw new Error("not implemented yet");
}
