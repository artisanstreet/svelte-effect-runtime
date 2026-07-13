import { copy_property_descriptors, has_method } from "./utils.ts";
import { InvalidCommandFactoryError } from "$/errors.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import type { NativeMethod, Pending } from "./types.ts";
import { DecodeResponseOrValue } from "./responses.ts";
import { MakeEffectFromPromise } from "./effect.ts";
import { Effect } from "effect";

type EffectRemoteCommandAdapter<Input, Output, ErrorType = never> = ((
	input: undefined extends Input ? Input | void : Input,
) => Effect.Effect<Output, RemoteFailure<ErrorType>>) & {
	readonly pending: number;
};

/** Adapts a generated SvelteKit command to SER's Effect-based client ABI. */
export function create_remote_command_adapter<Input, Output, ErrorType = never>(
	native_factory: unknown,
	decode_payload: (value: unknown) => unknown,
	_base = "",
	pending?: Pending,
): EffectRemoteCommandAdapter<Input, Output, ErrorType> {
	const invoke = has_method(native_factory, "invoke") ? native_factory.invoke : undefined;

	if (typeof native_factory !== "function" && !invoke) {
		throw new InvalidCommandFactoryError();
	}

	const count = pending ?? { value: 0 };

	const adapter = (input: undefined extends Input ? Input | void : Input) =>
		Effect.acquireUseRelease(
			AcquirePending(count),
			() =>
				InvokeCommand<Input, Output, ErrorType>(
					native_factory,
					invoke,
					input,
					decode_payload,
				),
			() => ReleasePending(count),
		);

	copy_property_descriptors(native_factory, adapter);

	if (!Object.prototype.hasOwnProperty.call(adapter, "pending")) {
		Object.defineProperty(adapter, "pending", {
			get: () => count.value,
		});
	}

	return adapter as EffectRemoteCommandAdapter<Input, Output, ErrorType>;
}

function AcquirePending(pending: Pending): Effect.Effect<void> {
	return Effect.sync(() => {
		pending.value += 1;
	});
}

function ReleasePending(pending: Pending): Effect.Effect<void> {
	return Effect.sync(() => {
		pending.value -= 1;
	});
}

function InvokeCommand<Input, Output, ErrorType>(
	native_factory: unknown,
	invoke: NativeMethod | undefined,
	input: undefined extends Input ? Input | void : Input,
	decode_payload: (value: unknown) => unknown,
): Effect.Effect<Output, RemoteFailure<ErrorType>> {
	return Effect.gen(function* () {
		const result = yield* MakeEffectFromPromise<unknown, ErrorType>(() =>
			Promise.resolve(
				invoke
					? invoke.call(native_factory, input)
					: (native_factory as NativeMethod)(input),
			),
		);

		return yield* DecodeResponseOrValue<Output, ErrorType>(result, decode_payload);
	});
}
