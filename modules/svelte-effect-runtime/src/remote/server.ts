import { create_serialized_remote_failure_envelope } from "$/remote/shared.ts";
import { RemoteHelperContextError, RemoteHelperError } from "$/errors.ts";
import { classify_remote_cause } from "$/remote/cause-codec.ts";
import type { FormIssue } from "$/remote/shared.ts";
import { Cause, Effect, Exit } from "effect";

type SvelteInvalid = (...issues: readonly (FormIssue | string)[]) => never;

type SvelteError = (status: number, body: unknown) => never;

const request_event_context_error_start =
	"Can only read the current request event inside functions invoked during `handle`";

const request_store_context_error = "Could not get the request store.";

export { encode_remote_failure } from "$/remote/cause-codec.ts";

/** Maps a remote Effect exit into the control flow expected by SvelteKit. */
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

export function throw_form_error(issues: readonly FormIssue[], invalid: SvelteInvalid): never {
	invalid(...issues);
}

/** Rebrands SvelteKit context failures with the remote helper that triggered them. */
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
