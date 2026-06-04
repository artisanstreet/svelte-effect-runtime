import { create_serialized_remote_failure_envelope } from "$/remote/shared.ts";
import { Cause, Effect, Exit } from "effect";
import { stringify } from "devalue";
import type { FormIssue } from "$/remote/shared.ts";

/**
 * Runs a user-supplied Effect program through a ManagedRuntime, maps its
 * exit into the shape expected by SvelteKit, and returns the result or
 * throws a SvelteKit-compatible error.
 *
 * @since 2.0.0
 * @param effect - The Effect program to execute.
 * @param runtime - The server-side ManagedRuntime.
 * @param invalid - SvelteKit's `invalid` helper (bound per-request).
 * @param error - SvelteKit's `error` helper.
 * @returns A Promise that resolves with the effect's success value.
 * @internal
 */
export async function run_remote_effect<A>(
  effect: Effect.Effect<A, unknown, unknown>,
  runtime: {
    runPromise: (
      e: Effect.Effect<unknown, unknown, unknown>,
    ) => Promise<unknown>;
  },
  invalid: (status: number, body: unknown) => never,
  error: (status: number, body: unknown) => never,
): Promise<A> {
  const exit: Exit.Exit<A, unknown> = await runtime.runPromise(
    Effect.exit(effect) as Effect.Effect<unknown, unknown, unknown>,
  ) as Exit.Exit<A, unknown>;

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  handle_failure(exit.cause, invalid, error);
}

/**
 * Inspects the Effect Cause for failures and either throws a form
 * validation error (via SvelteKit's `invalid`) or encodes the error
 * and throws it via SvelteKit's `error`.
 */
function handle_failure(
  cause: Cause.Cause<unknown>,
  invalid: (status: number, body: unknown) => never,
  error: (status: number, body: unknown) => never,
): never {
  const reasons =
    (cause as unknown as { reasons: Array<{ _tag: string; error?: unknown }> })
      .reasons;

  for (const reason of reasons) {
    if (Cause.isFailReason(reason as never)) {
      const failure = reason.error;
      if (
        typeof failure === "object" &&
        failure !== null &&
        (failure as Record<string, unknown>)._tag === "FormError"
      ) {
        const issues = (failure as { issues?: readonly FormIssue[] }).issues ??
          [];
        invalid(400, { issues });
      }
    }
  }

  const encoded = encode_remote_failure(cause);
  const envelope = create_serialized_remote_failure_envelope(encoded);

  error(500, envelope);
}

/**
 * Encodes an Effect Cause into a string that the client-side adapter can
 * decode back into a typed `RemoteFailure`.
 *
 * @since 2.0.0
 * @param cause - The Effect Cause from a failed execution.
 * @returns A devalue-encoded string representing the serialised failure.
 * @internal
 */
export function encode_remote_failure(cause: Cause.Cause<unknown>): string {
  const reasons =
    (cause as unknown as { reasons: Array<{ _tag: string; error?: unknown }> })
      .reasons;

  for (const reason of reasons) {
    if (Cause.isFailReason(reason as never)) {
      const failure = reason.error;
      if (typeof failure === "object" && failure !== null) {
        try {
          return stringify(failure);
        } catch {
          continue;
        }
      }
    }
  }

  return stringify({ message: "[UNKNOWN_REMOTE_FAILURE]: Unknown error" });
}

/**
 * Throws a SvelteKit `invalid` response from a {@link FormError}, calling
 * through to the request-scoped `invalid` helper.
 *
 * @example
 * ```ts
 * throw_form_error(
 *   [{ message: "Name is required", path: ["name"] }],
 *   invalid,
 * );
 * ```
 *
 * @since 2.0.0
 * @param issues - The list of form validation issues.
 * @param invalid - SvelteKit's `invalid` helper bound to the current request.
 * @internal
 */
export function throw_form_error(
  issues: readonly FormIssue[],
  invalid: (status: number, body: unknown) => never,
): never {
  invalid(400, { issues });
}

/**
 * Remaps low-level SvelteKit errors (e.g. "Cannot use ___ outside a route")
 * into clear, actionable messages.
 *
 * @example
 * ```ts
 * try {
 *   return native_query(handler);
 * } catch (err) {
 *   throw normalize_remote_helper_error(err, "Query");
 * }
 * ```
 *
 * @since 2.0.0
 * @param err - The error thrown by SvelteKit's native functions.
 * @param helper_name - Name of the helper that triggered the error.
 * @returns A more descriptive error.
 * @internal
 */
export function normalize_remote_helper_error(
  err: unknown,
  helper_name: string,
): Error {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("Cannot use") || message.includes("outside a route")) {
    return new Error(
      `[REMOTE_HELPER_CONTEXT]: ${helper_name} was called outside a .remote.ts file. ` +
        `Ensure the file is named \`*.remote.ts\` and is located in a route directory.`,
    );
  }

  return err instanceof Error
    ? err
    : new Error(`[REMOTE_HELPER_ERROR]: ${message}`);
}
