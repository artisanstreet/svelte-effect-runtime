import type { RemoteFailure } from "$/remote/shared.ts";
import { DecodeResponseOrValue } from "./responses.ts";
import { MakeEffectFromPromise } from "./effect.ts";
import { has_method } from "./utils.ts";
import { Effect } from "effect";

export function ResolveQueryResult<Output, ErrorType = never>(
	value: unknown,
	decode_payload: (value: unknown) => unknown,
): Effect.Effect<Output, RemoteFailure<ErrorType>> {
	return Effect.gen(function* () {
		if (has_method(value, "then")) {
			const result = yield* MakeEffectFromPromise<unknown, ErrorType>(() =>
				Promise.resolve(value),
			);

			return yield* DecodeResponseOrValue<Output, ErrorType>(result, decode_payload);
		}

		if (has_method(value, "run")) {
			const result = yield* MakeEffectFromPromise<unknown, ErrorType>(() =>
				Promise.resolve(value.run()),
			);

			return yield* DecodeResponseOrValue<Output, ErrorType>(result, decode_payload);
		}

		return yield* DecodeResponseOrValue<Output, ErrorType>(value, decode_payload);
	});
}
