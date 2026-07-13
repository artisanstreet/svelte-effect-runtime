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
 *   The supplied signal is aborted when the Effect is interrupted.
 * @returns Effect that maps thrown values into remote failures.
 */
export function MakeEffectFromPromise<Output, ErrorType = never>(
	run: (signal: AbortSignal) => PromiseLike<Output>,
): Effect.Effect<Output, RemoteFailure<ErrorType>> {
	return Effect.tryPromise({
		try: run,
		catch: normalize_effect_error<ErrorType>,
	});
}

/**
 * Wraps a synchronous remote operation in an Effect with failure mapping.
 *
 * @example
 * ```ts
 * const Program = MakeEffectFromSync(() => decode_payload(value));
 * ```
 *
 * @since 4.0.1
 * @param run - Synchronous operation that may throw a native remote failure.
 * @returns Effect that maps thrown values into remote failures.
 */
export function MakeEffectFromSync<Output, ErrorType = never>(
	run: () => Output,
): Effect.Effect<Output, RemoteFailure<ErrorType>> {
	return Effect.try({
		try: run,
		catch: normalize_effect_error<ErrorType>,
	});
}

function normalize_effect_error<ErrorType>(error: unknown): RemoteFailure<ErrorType> {
	if (isRedirect(error)) {
		throw error;
	}

	if (is_decoded_remote_failure(error)) {
		return error;
	}

	return normalize_native_error<ErrorType>(error);
}
