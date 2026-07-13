import { decode_remote_error, is_decoded_remote_failure } from "./failures.ts";
import { MakeEffectFromPromise, MakeEffectFromSync } from "./effect.ts";
import { create_remote_http_error } from "$/remote/shared.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { Effect } from "effect";

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
