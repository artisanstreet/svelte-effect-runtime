import type { RemoteForm, RemoteFormInput, RemoteQueryUpdate } from "@sveltejs/kit";
import type { RemoteFailure } from "$/remote/shared.ts";
import type { Effect, Schema, Stream } from "effect";

/** Runtime brand used to distinguish query-update callbacks. */
export declare const effect_remote_query_update: unique symbol;

export type EffectRemoteQueryUpdateBrand = {
	readonly [effect_remote_query_update]: true;
};

type EffectRemoteFormCallable<Input extends RemoteFormInput | void, Output, ErrorType> = [
	Input,
] extends [void]
	? () => Effect.Effect<Output, RemoteFailure<ErrorType>>
	: undefined extends Input
		? (input?: Input) => Effect.Effect<Output, RemoteFailure<ErrorType>>
		: (input: Input) => Effect.Effect<Output, RemoteFailure<ErrorType>>;

type NativeRemoteFormPreflightSchema<Input extends RemoteFormInput | void, Output> = Parameters<
	RemoteForm<Input, Output>["preflight"]
>[0];

type NativeRemoteFormValidateOptions<Input extends RemoteFormInput | void, Output> = NonNullable<
	Parameters<RemoteForm<Input, Output>["validate"]>[0]
>;

export type EffectRemoteFormPreflightSchema<
	Input extends RemoteFormInput | void,
	Output = unknown,
> = NativeRemoteFormPreflightSchema<Input, Output> | Schema.Codec<unknown, Input, never, unknown>;

export type EffectRemoteFormValidateOptions<
	Input extends RemoteFormInput | void,
	Output = unknown,
> = Omit<
	NativeRemoteFormValidateOptions<Input, Output>,
	"all" | "includeUntouched" | "preflightOnly"
> & {
	readonly all?: boolean;
	readonly includeUntouched?: boolean;
	readonly preflightOnly?: boolean;
};

type EffectRemoteQueryUpdate =
	| NativeRemoteQueryUpdate
	| EffectRemoteQueryUpdateFunction
	| EffectRemoteLiveQueryUpdateFunction;

type EffectRemoteCommandUpdate = {
	readonly pending: number;
};

type EffectRemoteQueryUpdateInput<Update> = Update extends EffectRemoteCommandUpdate
	? never
	: Update extends EffectRemoteQueryUpdate
		? Update
		: never;

type EffectRemoteQueryUpdates<Updates extends readonly unknown[]> = Updates & {
	[Index in keyof Updates]: EffectRemoteQueryUpdateInput<Updates[Index]>;
};

type NativeRemoteQueryUpdate = RemoteQueryUpdate;

type EffectRemoteQueryUpdateFunction = (input: never) => EffectRemoteQueryUpdateResource;

type EffectRemoteLiveQueryUpdateFunction = (
	input: never,
) => Stream.Stream<unknown, unknown, unknown>;

type EffectRemoteQueryUpdateResource = Effect.Effect<unknown, unknown> & {
	readonly refresh: () => Effect.Effect<void, unknown, never>;
	readonly set: (value: never) => void;
	readonly withOverride: (update: never) => unknown;
};

export interface Pending {
	value: number;
}

export type NativeMethod = (...args: unknown[]) => unknown;

export type NativeFormRecord = Record<PropertyKey, unknown>;

export type EffectRemoteCommandCall<Output, ErrorType = never> = Effect.Effect<
	Output,
	RemoteFailure<ErrorType>
> & {
	updates: <const Updates extends readonly unknown[]>(
		...updates: EffectRemoteQueryUpdates<Updates>
	) => Effect.Effect<Output, RemoteFailure<ErrorType>>;
};

export type EffectRemoteFormSubmit<Output = unknown, ErrorType = never> = Effect.Effect<
	Output | undefined,
	RemoteFailure<ErrorType>
> & {
	updates: <const Updates extends readonly unknown[]>(
		...updates: EffectRemoteQueryUpdates<Updates>
	) => Effect.Effect<Output | undefined, RemoteFailure<ErrorType>>;
};

export type EffectRemoteFormEnhanceOptions<
	Input extends RemoteFormInput | void,
	Output,
	ErrorType = never,
> = Omit<
	Parameters<RemoteForm<Input, Output>["enhance"]>[0] extends (options: infer Options) => unknown
		? Options
		: never,
	"submit"
> & {
	submit: () => EffectRemoteFormSubmit<Output, ErrorType>;
};

export type EffectRemoteForm<
	Input extends RemoteFormInput | void,
	Output,
	ErrorType = never,
> = EffectRemoteFormCallable<Input, Output, ErrorType> &
	Omit<RemoteForm<Input, Output>, "enhance" | "for" | "preflight" | "submit" | "validate"> & {
		enhance(
			callback?: (
				options: EffectRemoteFormEnhanceOptions<Input, Output, ErrorType>,
			) => void | Promise<void> | Effect.Effect<void, unknown, unknown>,
		): ReturnType<RemoteForm<Input, Output>["enhance"]>;
		for(
			id: Parameters<RemoteForm<Input, Output>["for"]>[0],
		): EffectRemoteFormCallable<Input, Output, ErrorType> &
			Omit<EffectRemoteForm<Input, Output, ErrorType>, "for">;
		preflight(
			schema: EffectRemoteFormPreflightSchema<Input, Output>,
		): EffectRemoteForm<Input, Output, ErrorType>;
		submit: EffectRemoteFormCallable<Input, Output, ErrorType>;
		validate(
			options?: EffectRemoteFormValidateOptions<Input, Output>,
		): Effect.Effect<void, RemoteFailure<ErrorType>>;
	};
