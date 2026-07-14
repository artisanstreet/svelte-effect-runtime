import { copy_property_descriptors, has_method } from "./utils.ts";
import { InvalidCommandFactoryError } from "$/errors.ts";
import type { EffectRemoteCommandCall, NativeMethod, Pending } from "./types.ts";
import { DecodeResponseOrValue } from "./responses.ts";
import { MakeEffectFromPromise, MakeEffectFromSync } from "$/remote/effect.ts";
import { Effect } from "effect";

type EffectRemoteCommandAdapter<Input, Output, ErrorType = never> = ((
	input: undefined extends Input ? Input | void : Input,
) => EffectRemoteCommandCall<Output, ErrorType>) & {
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
		MakeCommandEffect<Input, Output, ErrorType>(
			native_factory,
			invoke,
			input,
			decode_payload,
			count,
		);

	copy_property_descriptors(native_factory, adapter);

	if (!Object.prototype.hasOwnProperty.call(adapter, "pending")) {
		Object.defineProperty(adapter, "pending", {
			get: () => count.value,
		});
	}

	return adapter as EffectRemoteCommandAdapter<Input, Output, ErrorType>;
}

const MakeCommandEffect = <Input, Output, ErrorType>(
	native_factory: unknown,
	invoke: NativeMethod | undefined,
	input: undefined extends Input ? Input | void : Input,
	decode_payload: (value: unknown) => unknown,
	pending: Pending,
) => {
	let updates_args: unknown[] | undefined;

	const CommandEffect = Effect.acquireUseRelease(
		AcquirePending(pending),
		() =>
			InvokeCommand<Input, Output, ErrorType>(
				native_factory,
				invoke,
				input,
				decode_payload,
				() => updates_args,
			),
		() => ReleasePending(pending),
	) as EffectRemoteCommandCall<Output, ErrorType>;

	Object.defineProperty(CommandEffect, "updates", {
		configurable: true,
		enumerable: false,
		value: (...args: unknown[]) => {
			updates_args ??= args;

			return CommandEffect;
		},
	});

	return CommandEffect;
};

const AcquirePending = (pending: Pending) =>
	Effect.sync(() => {
		pending.value += 1;
	});

const ReleasePending = (pending: Pending) =>
	Effect.sync(() => {
		pending.value -= 1;
	});

const InvokeCommand = <Input, Output, ErrorType>(
	native_factory: unknown,
	invoke: NativeMethod | undefined,
	input: undefined extends Input ? Input | void : Input,
	decode_payload: (value: unknown) => unknown,
	read_updates_args: () => unknown[] | undefined,
) =>
	Effect.gen(function* () {
		const invocation = yield* MakeEffectFromSync<unknown, ErrorType>(() => {
			const result = invoke
				? invoke.call(native_factory, input)
				: (native_factory as NativeMethod)(input);
			const updates_args = read_updates_args();

			if (updates_args && has_method(result, "updates")) {
				return result.updates(...updates_args);
			}

			return result;
		});
		const result = yield* MakeEffectFromPromise<unknown, ErrorType>(() =>
			Promise.resolve(invocation),
		);

		return yield* DecodeResponseOrValue<Output, ErrorType>(result, decode_payload);
	});
