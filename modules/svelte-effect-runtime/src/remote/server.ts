import { create_serialized_remote_failure_envelope } from "$/remote/shared.ts";
import type { FormIssue } from "$/remote/shared.ts";
import { RemoteHelperContextError, RemoteHelperError } from "$/errors.ts";
import { classify_remote_cause } from "$/remote/cause-codec.ts";
import { Cause, Effect, Exit } from "effect";

type SvelteInvalid = (...issues: readonly (FormIssue | string)[]) => never;

type SvelteError = (status: number, body: unknown) => never;

const request_event_context_error_start =
	"Can only read the current request event inside functions invoked during `handle`";

const request_store_context_error = "Could not get the request store.";

export { encode_remote_failure } from "$/remote/cause-codec.ts";

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
		runPromise: (e: Effect.Effect<unknown, unknown, unknown>) => Promise<unknown>;
	},
	invalid: SvelteInvalid,
	error: SvelteError,
): Promise<A> {
	const exit: Exit.Exit<A, unknown> = (await runtime.runPromise(
		Effect.exit(effect) as Effect.Effect<unknown, unknown, unknown>,
	)) as Exit.Exit<A, unknown>;

	if (Exit.isSuccess(exit)) {
		return exit.value;
	}

	handle_failure(exit.cause, invalid, error);
}

/**
 * Applies a classified remote Cause decision to SvelteKit's server helpers.
 */
function handle_failure(
	cause: Cause.Cause<unknown>,
	invalid: SvelteInvalid,
	error: SvelteError,
): never {
	const resolution = classify_remote_cause(cause);

	switch (resolution._tag) {
		case "SvelteKitControlFlow": {
			throw resolution.value;
		}
		case "InterruptOnly": {
			throw Cause.squash(resolution.cause);
		}
		case "FormInvalid": {
			invalid(...resolution.issues);
		}
		case "RemoteFailure": {
			const envelope = create_serialized_remote_failure_envelope(resolution.encoded);

			error(500, envelope);
		}
	}
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
export function throw_form_error(issues: readonly FormIssue[], invalid: SvelteInvalid): never {
	invalid(...issues);
}

/**
 * Remaps SvelteKit's unbranded request-context errors into clear, actionable
 * messages.
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
export function normalize_remote_helper_error(err: unknown, helper_name: string): Error {
	if (is_sveltekit_remote_context_error(err)) {
		return new RemoteHelperContextError(helper_name);
	}

	return err instanceof Error ? err : new RemoteHelperError(err);
}

function is_sveltekit_remote_context_error(err: unknown): err is Error {
	if (!(err instanceof Error)) {
		return false;
	}

	return (
		err.message.startsWith(request_event_context_error_start) ||
		err.message === request_store_context_error
	);
}
