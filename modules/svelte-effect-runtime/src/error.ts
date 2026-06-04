/**
 * Formats a runtime-owned error message with a stable screaming-case code.
 *
 * @example
 * ```ts
 * throw new Error(make_error_message("DISPATCHER_DISPOSED", "Dispatcher has been disposed"));
 * ```
 *
 * @since 2.0.0
 * @param code - Stable screaming-case identifier for the error category.
 * @param message - Human-readable error message without the leading code.
 * @returns The complete error message prefixed with the stable code.
 */
export function make_error_message(code: string, message: string): string {
  return `[${code}]: ${message}`;
}

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
 * Thrown when a statement mixes JavaScript `await` with Effect `yield*` work
 * that must be lowered into an `Effect.gen` program.
 *
 * @since 2.0.0
 */
export class AwaitInEffectWorkError extends PreprocessError {
  /**
   * The full text of the problematic statement containing mixed async work.
   *
   * @since 2.0.0
   */
  readonly statement_text: string;

  constructor(filename: string, statement_text: string) {
    super(
      [
        make_error_message(
          "AWAIT_IN_EFFECT_WORK",
          `${filename}: await cannot be mixed with yield* in Effect work.`,
        ),
        `Top-level await is supported as ordinary Svelte async rendering, but statements lowered into Effect.gen must use yield* for async Effect work.`,
        "",
        `Problematic statement:`,
        statement_text,
      ].join("\n"),
      filename,
    );
    this.name = "AwaitInEffectWorkError";
    this.statement_text = statement_text;
  }
}

/**
 * Thrown when async Effect work appears inside a Svelte rune position that
 * must stay synchronous.
 *
 * @since 2.0.0
 */
export class AsyncEffectInSyncRuneError extends PreprocessError {
  /**
   * The name of the rune that contained async Effect work.
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
        make_error_message(
          "ASYNC_EFFECT_IN_SYNC_RUNE",
          `${filename}: yield* cannot be used inside ${rune_name}().`,
        ),
        `${rune_name}() must stay synchronous. Do not put async Effect work inside this rune.`,
        "",
        `Problematic expression:`,
        expression_text,
      ].join("\n"),
      filename,
    );
    this.name = "AsyncEffectInSyncRuneError";
    this.rune_name = rune_name;
    this.expression_text = expression_text;
  }
}

/**
 * Thrown when async Effect work appears inside a non-generator callback nested
 * in a markup event handler.
 *
 * @example
 * ```ts
 * throw new AsyncEffectInEventCallbackError(
 *   "Component.svelte",
 *   "Effect.try(() => yield* save())",
 * );
 * ```
 *
 * @since 2.0.0
 */
export class AsyncEffectInEventCallbackError extends PreprocessError {
  /**
   * The full text of the problematic event handler body.
   *
   * @since 2.0.0
   */
  readonly expression_text: string;

  constructor(filename: string, expression_text: string) {
    super(
      [
        make_error_message(
          "ASYNC_EFFECT_IN_EVENT_CALLBACK",
          `${filename}: yield* cannot be used inside a nested non-generator callback in a markup event handler.`,
        ),
        `Move the yield* to the event handler body. Effect.try and Effect.sync callbacks are plain synchronous JavaScript; do not call Effect-returning functions inside them.`,
        "",
        `Run the remote Effect directly:`,
        `  onclick={() => yield* UpvotePost(id)}`,
        "",
        `Recover from remote failures by composing the Effect value:`,
        `  onclick={() => yield* UpvotePost(id).pipe(Effect.catch(() => Effect.void))}`,
        "",
        `Problematic expression:`,
        expression_text,
      ].join("\n"),
      filename,
    );
    this.name = "AsyncEffectInEventCallbackError";
    this.expression_text = expression_text;
  }
}
