import { MakeEffectFromPromise, MakeEffectFromSync } from "./effect.ts";
import type { EffectRemoteFormSubmit, NativeMethod } from "./types.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { get_dispatcher } from "$/dispatcher.ts";
import { has_method } from "./utils.ts";
import { Effect } from "effect";

export function wrap_enhance_callback<Output, ErrorType = never>(
	callback: NativeMethod | undefined,
): NativeMethod | undefined {
	if (!callback) {
		return undefined;
	}

	return (event: unknown) => {
		const wrapped_event = wrap_submit_callback<Output, ErrorType>(event);
		const result = callback(wrapped_event);

		if (Effect.isEffect(result)) {
			return get_dispatcher().run(result);
		}

		return result;
	};
}

function wrap_submit_callback<Output, ErrorType>(event: unknown): unknown {
	if (typeof event !== "object" || event === null || !has_method(event, "submit")) {
		return event;
	}

	const original_submit = event.submit;
	const { submit: _submit, ...descriptors } = Object.getOwnPropertyDescriptors(event);

	void _submit;

	return Object.defineProperties(
		{},
		{
			...descriptors,
			submit: {
				configurable: true,
				enumerable: false,
				value: () => MakeSubmitEffect<Output, ErrorType>(original_submit, event),
			},
		},
	);
}

function MakeSubmitEffect<Output, ErrorType>(
	original_submit: NativeMethod,
	event: unknown,
): EffectRemoteFormSubmit<Output, ErrorType> {
	let updates_args: unknown[] | undefined;

	const SubmitEffect = Effect.gen(function* () {
		const result = yield* MakeEffectFromSync<unknown, ErrorType>(() =>
			original_submit.call(event),
		);
		const value = yield* ResolveSubmitResult<ErrorType>(result, updates_args);

		if (typeof value === "boolean") {
			return read_submit_result<Output>(event);
		}

		return value as Output;
	}) as EffectRemoteFormSubmit<Output, ErrorType>;

	Object.defineProperty(SubmitEffect, "updates", {
		configurable: true,
		enumerable: false,
		value: (...args: unknown[]) => {
			updates_args ??= args;

			return SubmitEffect;
		},
	});

	return SubmitEffect;
}

function ResolveSubmitResult<ErrorType>(
	result: unknown,
	updates_args: unknown[] | undefined,
): Effect.Effect<unknown, RemoteFailure<ErrorType>> {
	return Effect.gen(function* () {
		if (updates_args && has_method(result, "updates")) {
			return yield* MakeEffectFromPromise<unknown, ErrorType>(() =>
				Promise.resolve(result.updates(...updates_args)),
			);
		}

		return yield* MakeEffectFromPromise<unknown, ErrorType>(() => Promise.resolve(result));
	});
}

function read_submit_result<Output>(event: unknown): Output | undefined {
	if (typeof event !== "object" || event === null || !("result" in event)) {
		return undefined;
	}

	return Reflect.get(event, "result") as Output | undefined;
}
