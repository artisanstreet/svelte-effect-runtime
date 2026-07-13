import { is_decoded_remote_failure, normalize_native_error } from "./failures.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { isRedirect } from "@sveltejs/kit";
import { Effect } from "effect";

/**
 * Wraps a promise-producing remote operation in an Effect with failure mapping.
 *
 * @example
 * ```ts
 * const Program = MakeEffectFromPromise(() => native_remote(input));
 * ```
 *
 * @since 2.0.0
 * @param run - Promise-producing operation that invokes a native remote helper.
 * @returns Effect that maps thrown values into remote failures.
 */
export function MakeEffectFromPromise<Output, ErrorType = never>(
	run: () => Promise<Output>,
): Effect.Effect<Output, RemoteFailure<ErrorType>> {
	return Effect.tryPromise({
		try: run,
		catch: (error: unknown) => {
			if (isRedirect(error)) {
				throw error;
			}

			if (is_decoded_remote_failure(error)) {
				return error;
			}

			return normalize_native_error<ErrorType>(error);
		},
	}) as Effect.Effect<Output, RemoteFailure<ErrorType>>;
}
