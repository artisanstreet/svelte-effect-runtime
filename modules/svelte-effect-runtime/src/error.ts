/**
 * Base error class for all preprocessor errors emitted during script and
 * markup transformation. Carries the source filename so error messages can
 * reference the affected file.
 *
 * @since 2.0.0
 */
export class PreprocessError extends Error {
  /**
   * The source filename that triggered this error.
   *
   * @since 2.0.0
   */
  readonly filename: string;

  constructor(message: string, filename: string) {
    super(message);
    this.name = "PreprocessError";
    this.filename = filename;
  }
}

/**
 * Thrown when `await` is used at the top level of a `<script effect>` block.
 * Top-level `await` is not supported — users should use
 * `yield* Effect.promise(...)` or `yield* Effect.tryPromise(...)` instead.
 *
 * @since 2.0.0
 */
export class TopLevelAwaitError extends PreprocessError {
  /**
   * The full text of the problematic statement containing the `await`.
   *
   * @since 2.0.0
   */
  readonly statement_text: string;

  constructor(filename: string, statement_text: string) {
    super(
      [
        `${filename}: top-level await is not supported in <script effect>.`,
        `Use yield* Effect.promise(...) or yield* Effect.tryPromise(...) instead.`,
        "",
        `Problematic statement:`,
        statement_text,
      ].join("\n"),
      filename,
    );
    this.name = "TopLevelAwaitError";
    this.statement_text = statement_text;
  }
}

/**
 * Thrown when `yield*` appears inside a Svelte rune whose semantics do not
 * support async expressions. Users should extract the `yield*` into a
 * separate `$state` binding and feed the resolved value into the rune.
 *
 * @since 2.0.0
 */
export class YieldStarInRuneError extends PreprocessError {
  /**
   * The name of the rune that contained the yield* expression.
   *
   * @since 2.0.0
   */
  readonly rune_name: string;

  /**
   * The full text of the expression that triggered the error.
   *
   * @since 2.0.0
   */
  readonly expression_text: string;

  constructor(rune_name: string, expression_text: string, filename: string) {
    super(
      [
        `${filename}: yield* cannot be used inside ${rune_name}().`,
        `${rune_name}() expects a synchronous expression. Extract the yield* into a separate $state binding instead:`,
        "",
        `  let __temp = $state(yield* yourEffect());`,
        `  ${rune_name}(__temp);`,
        "",
        `Problematic expression:`,
        expression_text,
      ].join("\n"),
      filename,
    );
    this.name = "YieldStarInRuneError";
    this.rune_name = rune_name;
    this.expression_text = expression_text;
  }
}
