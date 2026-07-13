import { decode_remote_error, is_decoded_remote_failure } from "./failures.ts";
import { MakeEffectFromPromise, MakeEffectFromSync } from "./effect.ts";
import { create_remote_http_error } from "$/remote/shared.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { Effect } from "effect";

/**
 * Decodes a failed fetch response into the runtime failure model.
 *
 * @example
 * ```ts
 * const failure = yield* DecodeResponseFailure(response);
 * ```
 *
 * @since 2.0.0
 * @param response - Failed fetch response returned by the remote endpoint.
 * @returns An infallible Effect that resolves the remote failure represented
 *   by the response.
 */
export function DecodeResponseFailure<ErrorType = never>(
	response: Response,
): Effect.Effect<RemoteFailure<ErrorType>, never, never> {
	return Effect.gen(function* () {
		const body = yield* MakeEffectFromPromise<unknown, ErrorType>(() => response.json()).pipe(
			Effect.orElseSucceed(() => undefined),
		);
		const decoded = decode_remote_error<ErrorType>(body);

		if (is_decoded_remote_failure(decoded)) {
			return decoded;
		}

		return create_remote_http_error(response.status, body);
	});
}

/**
 * Decodes either a raw value or `Response` returned by a native remote helper.
 *
 * @example
 * ```ts
 * const output = yield* DecodeResponseOrValue(result, decode_payload);
 * ```
 *
 * @since 2.0.0
 * @param value - Native result value or fetch response.
 * @param decode_payload - Function used to decode successful payloads.
 * @returns An Effect that decodes the successful output or fails with a
 *   structured remote failure.
 */
export function DecodeResponseOrValue<Output, ErrorType = never>(
	value: unknown,
	decode_payload: (value: unknown) => unknown,
): Effect.Effect<Output, RemoteFailure<ErrorType>> {
	return Effect.gen(function* () {
		if (value instanceof Response) {
			if (!value.ok) {
				const failure = yield* DecodeResponseFailure<ErrorType>(value);

				return yield* Effect.fail(failure);
			}

			const data = yield* DecodeSuccessResponseBody<ErrorType>(value);

			return yield* MakeEffectFromSync<Output, ErrorType>(
				() => decode_payload(data) as Output,
			);
		}

		return yield* MakeEffectFromSync<Output, ErrorType>(() => decode_payload(value) as Output);
	});
}

function DecodeSuccessResponseBody<ErrorType>(
	response: Response,
): Effect.Effect<unknown, RemoteFailure<ErrorType>> {
	return Effect.gen(function* () {
		if (response.status === 204 || response.status === 205) {
			return undefined;
		}

		const text = yield* MakeEffectFromPromise<string, ErrorType>(() => response.text());

		if (text.length === 0) {
			return undefined;
		}

		return yield* MakeEffectFromSync<unknown, ErrorType>(() => JSON.parse(text));
	});
}
