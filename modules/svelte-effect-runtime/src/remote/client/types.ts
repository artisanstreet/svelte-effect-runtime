import type {
	RemoteForm,
	RemoteFormInput,
	RemoteLiveQuery,
	RemoteQuery,
	RemoteQueryOverride,
} from "@sveltejs/kit";
import type { RemoteFailure } from "$/remote/shared.ts";
import type { Effect, Schema } from "effect";

/**
 * Type-only marker attached to SER query and live-query adapter functions so
 * form updates can distinguish them from command adapters.
 *
 * @since 2.4.2
 * @internal
 */
export declare const EFFECT_REMOTE_QUERY_UPDATE: unique symbol;

/**
 * Type-only brand carried by SER query and live-query adapter functions.
 *
 * @since 2.4.2
 * @internal
 */
export type EffectRemoteQueryUpdateBrand = {
	readonly [EFFECT_REMOTE_QUERY_UPDATE]: true;
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

/**
 * Schema values accepted by SER's remote form preflight adapter.
 *
 * @example
 * ```ts
 * form.preflight(Schema.Struct({ email: Schema.String }));
 * ```
 *
 * @since 3.4.6
 */
export type EffectRemoteFormPreflightSchema<
	Input extends RemoteFormInput | void,
	Output = unknown,
> = NativeRemoteFormPreflightSchema<Input, Output> | Schema.Schema<unknown>;

/**
 * Options accepted by SER's remote form validation adapter.
 *
 * @example
 * ```ts
 * yield* form.validate({ all: true, preflightOnly: true });
 * ```
 *
 * @since 3.4.6
 */
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

type NativeRemoteQueryUpdate =
	| RemoteQuery<unknown>
	| RemoteLiveQuery<unknown>
	| RemoteQueryOverride;

type EffectRemoteQueryUpdateFunction = EffectRemoteQueryUpdateBrand &
	((input: never) => EffectRemoteQueryUpdateResource);

type EffectRemoteLiveQueryUpdateFunction = EffectRemoteQueryUpdateBrand &
	((input: never) => Effect.Effect<EffectRemoteLiveQueryUpdateResource, unknown>);

type EffectRemoteQueryUpdateResource = Effect.Effect<unknown, unknown> & {
	readonly refresh: () => Effect.Effect<void, unknown, never>;
	readonly set: (value: never) => void;
	readonly withOverride: (update: (current: never) => unknown) => unknown;
};

type EffectRemoteLiveQueryUpdateResource = {
	readonly connected: boolean;
	readonly current: unknown;
	readonly done: boolean;
	readonly error: unknown;
	readonly loading: boolean;
	readonly ready: boolean;
	readonly reconnect: () => Effect.Effect<void, unknown, never>;
} & AsyncIterable<unknown>;

/**
 * Represents a pending operation counter that remote command adapters
 * use to track in-flight requests.
 *
 * @since 2.0.0
 * @internal
 */
export interface Pending {
	/** Current count of in-flight requests. */
	value: number;
}

/**
 * Native callable method shape used when reflecting SvelteKit remote helpers.
 *
 * @since 2.0.0
 */
export type NativeMethod = (...args: unknown[]) => unknown;

/**
 * Property bag shape used for native SvelteKit form objects.
 *
 * @since 2.0.0
 */
export type NativeFormRecord = Record<PropertyKey, unknown>;

/**
 * Represents the native form submit handle passed into an Effect-aware
 * enhanced remote form callback.
 *
 * @example
 * ```ts
 * form.enhance(({ submit }) =>
 *   Effect.gen(function* () {
 *     yield* submit().updates();
 *   })
 * );
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteFormSubmit<Output = unknown, ErrorType = never> = Effect.Effect<
	Output | undefined,
	RemoteFailure<ErrorType>
> & {
	updates: <const Updates extends readonly unknown[]>(
		...updates: EffectRemoteQueryUpdates<Updates>
	) => Effect.Effect<Output | undefined, RemoteFailure<ErrorType>>;
};

/**
 * Represents the callback payload passed to an Effect-aware remote form
 * enhancement callback.
 *
 * @example
 * ```ts
 * form.enhance(({ data, submit }) =>
 *   Effect.gen(function* () {
 *     console.log(data);
 *     yield* submit();
 *   })
 * );
 * ```
 *
 * @since 2.0.0
 */
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

/**
 * Represents a SvelteKit remote form whose submission, validation, and
 * enhancement hooks expose Effect-returning APIs.
 *
 * @example
 * ```ts
 * const form = create_remote_form_adapter(nativeForm, (value) => value);
 *
 * yield* form.preflight(schema).validate();
 * ```
 *
 * @since 2.0.0
 */
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
		): Omit<EffectRemoteForm<Input, Output, ErrorType>, "for">;
		preflight(
			schema: EffectRemoteFormPreflightSchema<Input, Output>,
		): EffectRemoteForm<Input, Output, ErrorType>;
		submit: EffectRemoteFormCallable<Input, Output, ErrorType>;
		validate(
			options?: EffectRemoteFormValidateOptions<Input, Output>,
		): Effect.Effect<void, RemoteFailure<ErrorType>>;
	};
