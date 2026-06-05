import { create_serialized_remote_failure_envelope } from "$/remote/shared.ts";
import type { FormIssue } from "$/remote/shared.ts";
import { isHttpError, isRedirect, isValidationError } from "@sveltejs/kit";
import { Cause, Effect, Exit } from "effect";
import { stringify } from "devalue";

type CauseReason = {
  readonly _tag: string;
  readonly defect?: unknown;
  readonly error?: unknown;
};

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
  const reasons = get_cause_reasons(cause);

  /**
   * Phase 1 — let SvelteKit's thrown control-flow sentinels escape.
   */
  for (const reason of reasons) {
    if (!Cause.isDieReason(reason as never)) {
      continue;
    }

    const defect = reason.defect;

    if (is_sveltekit_control_flow(defect)) {
      throw defect;
    }
  }

  /**
   * Phase 2 — preserve typed form validation failures.
   */
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

  /**
   * Phase 3 — encode all other failures for the remote client.
   */
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
  const reasons = get_cause_reasons(cause);

  for (const reason of reasons) {
    if (Cause.isFailReason(reason as never)) {
      const failure = reason.error;

      const encoded = stringify_failure(failure);

      if (encoded !== undefined) {
        return encoded;
      }

      const serializable_failure = to_serializable_failure(failure);
      const serializable_encoded = stringify_failure(serializable_failure);

      if (serializable_encoded !== undefined) {
        return serializable_encoded;
      }
    }
  }

  return stringify({ message: "Unknown error" });
}

function get_cause_reasons(
  cause: Cause.Cause<unknown>,
): readonly CauseReason[] {
  const reasons = (cause as unknown as { reasons?: readonly CauseReason[] })
    .reasons;

  return reasons ?? [];
}

function is_sveltekit_control_flow(value: unknown): boolean {
  return isRedirect(value) || isHttpError(value) || isValidationError(value);
}

function stringify_failure(value: unknown): string | undefined {
  try {
    return stringify(value);
  } catch {
    return undefined;
  }
}

function to_serializable_failure(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (!is_object_like(value)) {
    return value;
  }

  if (stringify_failure(value) !== undefined) {
    return value;
  }

  if (seen.has(value)) {
    return undefined;
  }

  seen.add(value);

  const serializable = Array.isArray(value)
    ? value.map((item) => to_serializable_failure(item, seen))
    : to_plain_record(value, seen);

  seen.delete(value);

  return serializable;
}

function to_plain_record(
  value: object,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const record: Record<string, unknown> = {};

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === "stack" || !("value" in descriptor)) {
      continue;
    }

    record[key] = to_serializable_failure(descriptor.value, seen);
  }

  if (value instanceof Error && !("message" in record)) {
    record.message = value.message;
  }

  return record;
}

function is_object_like(value: unknown): value is object {
  return typeof value === "object" && value !== null;
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
): globalThis.Error {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("Cannot use") || message.includes("outside a route")) {
    return new globalThis.Error(
      `${helper_name} was called outside a .remote.ts file. ` +
        `Ensure the file is named \`*.remote.ts\` and is located in a route directory.`,
    );
  }

  return err instanceof Error ? err : new globalThis.Error(message);
}
