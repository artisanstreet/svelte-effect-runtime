import { is_decoded_remote_failure, normalize_native_error } from "./failures.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { isRedirect } from "@sveltejs/kit";
import { Effect } from "effect";

export const MakeEffectFromPromise = <Output, ErrorType = never>(
	run: (signal: AbortSignal) => PromiseLike<Output>,
) =>
	Effect.tryPromise({
		try: run,
		catch: normalize_effect_error<ErrorType>,
	});

export const MakeEffectFromSync = <Output, ErrorType = never>(run: () => Output) =>
	Effect.try({
		try: run,
		catch: normalize_effect_error<ErrorType>,
	});

function normalize_effect_error<ErrorType>(error: unknown): RemoteFailure<ErrorType> {
	if (isRedirect(error)) {
		throw error;
	}

	if (is_decoded_remote_failure(error)) {
		return error;
	}

	return normalize_native_error<ErrorType>(error);
}
