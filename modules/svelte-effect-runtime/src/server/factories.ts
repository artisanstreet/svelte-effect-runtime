import type {
	EffectLike,
	EffectRemoteBatchHandler,
	EffectRemoteCommand,
	EffectRemoteCommandCall,
	EffectRemoteForm,
	EffectRemoteLiveQuery,
	EffectRemoteLiveQueryFunction,
	EffectRemotePrerender,
	EffectRemotePrerenderFunction,
	EffectRemoteQuery,
	EffectRemoteQueryFunction,
	PrerenderOptions,
	QueryFactory,
	RemoteFormHandler,
	RemoteHandler,
	RemoteLiveHandler,
	RemoteLiveSource,
	SchemaEncodedInput,
	SchemaInput,
	StandardSchema,
	StandardSchemaInput,
	StandardSchemaOutput,
} from "./types.ts";
import {
	BatchQueryHandlerMissingError,
	UncheckedCommandHandlerMissingError,
	UncheckedFormHandlerMissingError,
	UncheckedLiveQueryHandlerMissingError,
	UncheckedPrerenderHandlerMissingError,
	UncheckedQueryHandlerMissingError,
} from "$/errors.ts";
import {
	attach_failed_remote_query_resource,
	attach_failed_remote_resource_getters,
	attach_remote_resource_getters,
	is_remote_resource,
	type NativeRemoteResource,
	type RemoteResourceEffect,
} from "$/remote/resource.ts";
import {
	command as native_command,
	form as native_form,
	getRequestEvent as get_native_request_event,
	prerender as native_prerender,
	query as native_query,
} from "$app/server";
import {
	make_prerender_inputs_wrapper,
	make_remote_form_wrapper,
	make_remote_live_wrapper,
	make_remote_wrapper,
} from "./wrappers.ts";
import { make_failed_remote_live_stream, make_remote_live_stream } from "$/live.ts";
import { FailWithRemoteError, MakeEffectFromPromise, MakeEffectFromSync } from "$/remote/effect.ts";
import { is_running_remote_effect_handler } from "./remote-handler-context.ts";
import { is_handler, is_unchecked, normalize_validator } from "./schema.ts";
import { copy_property_descriptors } from "$/internal/descriptors.ts";
import { normalize_remote_helper_error } from "$/remote/server.ts";
import { create_remote_transport_error } from "$/remote/shared.ts";
import type { RemoteFormInput } from "@sveltejs/kit";
import { Effect, Result, type Schema } from "effect";

type FormSchemaEncodedInput<S> = S extends Schema.Top ? FormRemoteInput<S["Encoded"]> : never;

type FormRemoteInput<Input> =
	NormalizeFormEncoded<Input> extends RemoteFormInput ? NormalizeFormEncoded<Input> : never;

type FormStandardSchemaInput<S> =
	StandardSchemaInput<S> extends RemoteFormInput ? StandardSchemaInput<S> : RemoteFormInput;

type FormScalar = string | number | boolean | File;

type NormalizeFormEncoded<Value> = Value extends FormScalar
	? Value
	: Value extends ReadonlyArray<infer Item>
		? Array<NormalizeFormEncoded<Item>>
		: Value extends object
			? NormalizeFormObject<Value>
			: Value;

type NormalizeFormObject<Value> = {
	readonly [Key in keyof Value]: Key extends OptionalFormKeys<Value>
		? NormalizeFormEncoded<Exclude<Value[Key], undefined>>
		: NormalizeFormEncoded<Value[Key]>;
};

type OptionalFormKeys<Value> = {
	[Key in keyof Value]-?: Record<PropertyKey, never> extends Pick<Value, Key> ? Key : never;
}[keyof Value];

type NativeQueryLike<Input = unknown> = (input: Input) => unknown;

type AttachRemoteResource<Resource> = (resource: unknown, effect: Resource) => void;

type AttachFailedRemoteResource<Resource> = (error: unknown, effect: Resource) => void;

type QueryAdapterMode = "standard" | "batch";

type NativePrerenderOptions<Input> = {
	readonly inputs?: (() => Promise<Input[]>) | undefined;
	readonly dynamic?: boolean | undefined;
};

type CurrentRemoteRequestDetection =
	| {
			readonly _tag: "CurrentRemoteRequest";
			readonly event: {
				readonly isRemoteRequest?: boolean;
			};
	  }
	| {
			readonly _tag: "NoCurrentRemoteRequest";
	  };

const request_event_context_error_start =
	"Can only read the current request event inside functions invoked during `handle`";

const request_store_context_error = "Could not get the request store.";

function to_effect_query<Input, Output, ErrorType = never>(
	native: NativeQueryLike<Input>,
	mode: QueryAdapterMode = "standard",
): EffectRemoteQueryFunction<Input, Output, ErrorType> {
	return to_effect_remote_resource<
		Input,
		Output,
		ErrorType,
		EffectRemoteQuery<Output, ErrorType>
	>(
		native,
		attach_query_resource_methods,
		attach_failed_remote_query_resource,
		mode,
	) as unknown as EffectRemoteQueryFunction<Input, Output, ErrorType>;
}

function to_effect_prerender<Input, Output, ErrorType = never>(
	native: NativeQueryLike<Input>,
): EffectRemotePrerenderFunction<Input, Output, ErrorType> {
	return to_effect_remote_resource<
		Input,
		Output,
		ErrorType,
		EffectRemotePrerender<Output, ErrorType>
	>(
		native,
		attach_remote_resource_getters,
		attach_failed_remote_resource_getters,
	) as unknown as EffectRemotePrerenderFunction<Input, Output, ErrorType>;
}

function to_effect_command<Input, Output, ErrorType = never>(
	native: NativeQueryLike<Input>,
): EffectRemoteCommand<Input, Output, ErrorType> {
	const wrapped = ((input: Input) => {
		if (is_current_remote_request()) {
			return native(input);
		}

		return MakeServerCommandEffect<Input, Output, ErrorType>(native, input);
	}) as unknown as EffectRemoteCommand<Input, Output, ErrorType>;

	copy_property_descriptors(native, wrapped);

	return wrapped;
}

const MakeServerCommandEffect = <Input, Output, ErrorType>(
	native: NativeQueryLike<Input>,
	input: Input,
) => {
	let updates_args: unknown[] | undefined;

	const CommandEffect = Effect.gen(function* () {
		const invocation = yield* MakeEffectFromSync<unknown, ErrorType>(() => {
			const result = native(input);

			if (updates_args && has_command_updates(result)) {
				return result.updates(...updates_args);
			}

			return result;
		});

		return yield* MakeEffectFromPromise<Output, ErrorType>(
			() => Promise.resolve(invocation) as Promise<Output>,
		);
	}) as EffectRemoteCommandCall<Output, ErrorType>;

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

function has_command_updates(
	value: unknown,
): value is { readonly updates: (...updates: unknown[]) => unknown } {
	const value_type = typeof value;

	return (
		((value_type === "object" && value !== null) || value_type === "function") &&
		typeof (value as { readonly updates?: unknown }).updates === "function"
	);
}

function to_effect_remote_resource<
	Input,
	Output,
	ErrorType,
	Resource extends RemoteResourceEffect<Output, ErrorType>,
>(
	native: NativeQueryLike<Input>,
	attach_resource: AttachRemoteResource<Resource>,
	attach_failed_resource: AttachFailedRemoteResource<Resource>,
	mode: QueryAdapterMode = "standard",
): (input: Input) => Resource {
	const wrapped = ((input: Input) => {
		if (is_current_remote_request()) {
			return native(input);
		}

		const resource_attempt = Result.try(() => native(input));

		if (Result.isFailure(resource_attempt)) {
			const ResourceEffect = FailWithRemoteError<ErrorType>(
				resource_attempt.failure,
			) as unknown as Resource;

			attach_failed_resource(resource_attempt.failure, ResourceEffect);

			return ResourceEffect;
		}

		const resource = resource_attempt.success;
		const started_result = mode === "batch" ? begin_batch_resource(resource) : undefined;
		const ResourceEffect = MakeEffectFromPromise<Output, ErrorType>(
			() => (started_result ?? Promise.resolve(resource)) as Promise<Output>,
		) as Resource;

		attach_resource(resource, ResourceEffect);

		return ResourceEffect;
	}) as unknown as (input: Input) => Resource;

	copy_property_descriptors(native, wrapped);

	return wrapped;
}

function begin_batch_resource(resource: unknown): Promise<unknown> {
	const result = Promise.resolve(resource);

	void result.catch(() => {});

	return result;
}

function is_current_remote_request(): boolean {
	const detection = detect_current_remote_request();

	if (detection._tag === "NoCurrentRemoteRequest") {
		return false;
	}

	if (is_running_remote_effect_handler(detection.event)) {
		return false;
	}

	return detection.event.isRemoteRequest === true;
}

function detect_current_remote_request(): CurrentRemoteRequestDetection {
	try {
		const event = get_native_request_event() as { isRemoteRequest?: boolean };

		return {
			_tag: "CurrentRemoteRequest",
			event,
		};
	} catch (error: unknown) {
		if (is_request_event_context_error(error)) {
			return { _tag: "NoCurrentRemoteRequest" };
		}

		throw error;
	}
}

function is_request_event_context_error(error: unknown): error is Error {
	if (!(error instanceof Error)) {
		return false;
	}

	return (
		error.message.startsWith(request_event_context_error_start) ||
		error.message === request_store_context_error
	);
}

function to_effect_live_query<Input, Output, ErrorType = never>(
	native: NativeQueryLike<Input>,
): EffectRemoteLiveQueryFunction<Input, Output, ErrorType> {
	const wrapped = ((input: Input) => {
		const resource_attempt = Result.try(() => native(input));

		if (Result.isFailure(resource_attempt)) {
			return make_failed_remote_live_stream<Output, ErrorType>(
				resource_attempt.failure,
				create_remote_transport_error,
			) as EffectRemoteLiveQuery<Output, ErrorType>;
		}

		const resource = resource_attempt.success;

		return make_remote_live_stream<Output, ErrorType>(
			resource,
			create_remote_transport_error,
		) as EffectRemoteLiveQuery<Output, ErrorType>;
	}) as unknown as EffectRemoteLiveQueryFunction<Input, Output, ErrorType>;

	copy_property_descriptors(native, wrapped);

	return wrapped;
}

type NativeQueryResource<Output> = NativeRemoteResource<Output> & {
	readonly refresh?: () => Promise<void>;
	readonly set?: (value: Output) => void;
	readonly withOverride?: (update: (current: Output) => Output) => unknown;
};

function attach_query_resource_methods<Output, ErrorType = never>(
	resource: unknown,
	effect: EffectRemoteQuery<Output, ErrorType>,
): void {
	const methods = is_remote_resource<Output>(resource)
		? (resource as NativeQueryResource<Output>)
		: undefined;
	const refresh = methods?.refresh;
	const set = methods?.set;
	const with_override = methods?.withOverride;

	attach_remote_resource_getters(resource, effect);

	if (!methods) {
		return;
	}

	if (typeof refresh === "function") {
		Object.defineProperty(effect, "refresh", {
			configurable: true,
			value: () => MakeEffectFromPromise(() => Promise.resolve(refresh.call(resource))),
		});
	}

	if (typeof set === "function") {
		Object.defineProperty(effect, "set", {
			configurable: true,
			value: (value: Output) => set.call(resource, value),
		});
	}

	if (typeof with_override === "function") {
		Object.defineProperty(effect, "withOverride", {
			configurable: true,
			value: (update: (current: Output) => Output) => with_override.call(resource, update),
		});
	}
}

function normalize_prerender_options<Input>(
	options: PrerenderOptions<Input> | undefined,
): NativePrerenderOptions<Input> | undefined {
	if (!options) {
		return undefined;
	}

	return {
		dynamic: options.dynamic,
		inputs: options.inputs ? make_prerender_inputs_wrapper(options.inputs) : undefined,
	};
}

function QueryRoot<A, E = never, R = never>(
	validate_or_handler: EffectLike<A, E, R> | RemoteHandler<void, A, E, R>,
): EffectRemoteQueryFunction<void, A, E>;
function QueryRoot<Input, A, E = never, R = never>(
	validate_or_handler: "unchecked",
	maybe_handler: RemoteHandler<Input, A, E, R>,
): EffectRemoteQueryFunction<Input, A, E>;
function QueryRoot<S extends Schema.Schema<unknown>, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteHandler<SchemaInput<S>, A, E, R>,
): EffectRemoteQueryFunction<SchemaEncodedInput<S>, A, E>;
function QueryRoot<S extends StandardSchema, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteHandler<StandardSchemaOutput<S>, A, E, R>,
): EffectRemoteQueryFunction<StandardSchemaInput<S>, A, E>;
function QueryRoot(validate_or_handler: unknown, maybe_handler?: unknown): unknown {
	try {
		if (maybe_handler) {
			return to_effect_query(
				native_query(
					normalize_validator(validate_or_handler) as never,
					make_remote_wrapper(maybe_handler as RemoteHandler, "Query") as never,
				) as ReturnType<typeof native_query>,
			);
		}

		if (is_unchecked(validate_or_handler)) {
			throw new UncheckedQueryHandlerMissingError();
		}

		return to_effect_query(
			native_query(
				make_remote_wrapper(validate_or_handler as RemoteHandler, "Query") as never,
			) as ReturnType<typeof native_query>,
		);
	} catch (error: unknown) {
		throw normalize_remote_helper_error(error, "Query");
	}
}

function QueryBatch<Input, A, E = never, R = never>(
	validate_or_handler: "unchecked",
	maybe_handler: EffectRemoteBatchHandler<Input, A, E, R>,
): EffectRemoteQueryFunction<Input, A, E>;
function QueryBatch<S extends Schema.Schema<unknown>, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: EffectRemoteBatchHandler<SchemaInput<S>, A, E, R>,
): EffectRemoteQueryFunction<SchemaEncodedInput<S>, A, E>;
function QueryBatch<S extends StandardSchema, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: EffectRemoteBatchHandler<StandardSchemaOutput<S>, A, E, R>,
): EffectRemoteQueryFunction<StandardSchemaInput<S>, A, E>;
function QueryBatch(validate_or_handler: unknown, maybe_handler?: unknown): unknown {
	try {
		if (!maybe_handler) {
			throw new BatchQueryHandlerMissingError();
		}

		return to_effect_query(
			native_query.batch(
				normalize_validator(validate_or_handler) as never,
				make_remote_wrapper(maybe_handler as RemoteHandler, "Query.batch") as never,
			) as NativeQueryLike,
			"batch",
		);
	} catch (error: unknown) {
		throw normalize_remote_helper_error(error, "Query.batch");
	}
}

function QueryLive<A, E = never, R = never>(
	validate_or_handler: RemoteLiveSource<A, E, R> | RemoteLiveHandler<void, A, E, R>,
): EffectRemoteLiveQueryFunction<void, A, E>;
function QueryLive<Input, A, E = never, R = never>(
	validate_or_handler: "unchecked",
	maybe_handler: RemoteLiveHandler<Input, A, E, R>,
): EffectRemoteLiveQueryFunction<Input, A, E>;
function QueryLive<S extends Schema.Schema<unknown>, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteLiveHandler<SchemaInput<S>, A, E, R>,
): EffectRemoteLiveQueryFunction<SchemaEncodedInput<S>, A, E>;
function QueryLive<S extends StandardSchema, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteLiveHandler<StandardSchemaOutput<S>, A, E, R>,
): EffectRemoteLiveQueryFunction<StandardSchemaInput<S>, A, E>;
function QueryLive(validate_or_handler: unknown, maybe_handler?: unknown): unknown {
	try {
		if (maybe_handler) {
			return to_effect_live_query(
				native_query.live(
					normalize_validator(validate_or_handler) as never,
					make_remote_live_wrapper(
						maybe_handler as RemoteLiveHandler,
						"Query.live",
					) as never,
				) as NativeQueryLike,
			);
		}

		if (is_unchecked(validate_or_handler)) {
			throw new UncheckedLiveQueryHandlerMissingError();
		}

		return to_effect_live_query(
			native_query.live(
				make_remote_live_wrapper(
					validate_or_handler as RemoteLiveHandler,
					"Query.live",
				) as never,
			) as NativeQueryLike,
		);
	} catch (error: unknown) {
		throw normalize_remote_helper_error(error, "Query.live");
	}
}

/**
 * Factory for read-only remote query functions.
 *
 * @example
 * ```ts
 * export const getUser = Query(Schema.Struct({ id: Schema.String }), (input) =>
 *   Effect.succeed(input.id)
 * );
 *
 * export const getUserBatch = Query.batch(Schema.String, (ids) =>
 *   Effect.succeed((id) => ids.includes(id))
 * );
 * ```
 *
 * @since 2.0.0
 */
export const Query: QueryFactory = Object.assign(QueryRoot, {
	batch: QueryBatch,
	live: QueryLive,
});

/**
 * Creates a write-oriented remote command from a no-argument Effect handler.
 *
 * @example
 * ```ts
 * export const RebuildCache = Command(() => Effect.succeed("done"));
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - Effect value or no-argument handler to run on
 *   the server when the command is invoked.
 * @returns A command function that yields an Effect when called.
 */
export function Command<A, E = never, R = never>(
	validate_or_handler: EffectLike<A, E, R> | RemoteHandler<void, A, E, R>,
): EffectRemoteCommand<void, A, E>;

/**
 * Creates a write-oriented remote command with unchecked input.
 *
 * @example
 * ```ts
 * export const SaveDraft = Command("unchecked", (input: { id: string }) =>
 *   Effect.succeed(input.id)
 * );
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - `"unchecked"` sentinel that skips runtime input
 *   validation.
 * @param maybe_handler - Handler that receives the caller-provided input.
 * @returns A command function that yields an Effect when called with input.
 */
export function Command<Input, A, E = never, R = never>(
	validate_or_handler: "unchecked",
	maybe_handler: RemoteHandler<Input, A, E, R>,
): EffectRemoteCommand<Input, A, E>;

/**
 * Creates a write-oriented remote command validated with an Effect Schema.
 *
 * @example
 * ```ts
 * export const SaveUser = Command(Schema.Struct({ id: Schema.String }), ({ id }) =>
 *   Effect.succeed({ id, saved: true })
 * );
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - Effect Schema used to decode and validate
 *   caller input before the handler runs.
 * @param maybe_handler - Handler that receives the decoded schema output.
 * @returns A command function whose caller input is the schema encoded type.
 */
export function Command<S extends Schema.Schema<unknown>, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteHandler<SchemaInput<S>, A, E, R>,
): EffectRemoteCommand<SchemaEncodedInput<S>, A, E>;

/**
 * Creates a write-oriented remote command validated with a Standard Schema.
 *
 * @example
 * ```ts
 * export const Toggle = Command(standard_schema, (input) =>
 *   Effect.succeed(input.enabled)
 * );
 * ```
 *
 * @since 3.0.0
 * @param validate_or_handler - Standard Schema used to validate caller input
 *   before the handler runs.
 * @param maybe_handler - Handler that receives the decoded schema output.
 * @returns A command function whose caller input is the schema input type.
 */
export function Command<S extends StandardSchema, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteHandler<StandardSchemaOutput<S>, A, E, R>,
): EffectRemoteCommand<StandardSchemaInput<S>, A, E>;
export function Command(validate_or_handler: unknown, maybe_handler?: unknown): unknown {
	try {
		if (maybe_handler) {
			return to_effect_command(
				native_command(
					normalize_validator(validate_or_handler) as never,
					make_remote_wrapper(maybe_handler as RemoteHandler, "Command") as never,
				) as NativeQueryLike,
			);
		}

		if (is_unchecked(validate_or_handler)) {
			throw new UncheckedCommandHandlerMissingError();
		}

		return to_effect_command(
			native_command(
				make_remote_wrapper(validate_or_handler as RemoteHandler, "Command") as never,
			) as NativeQueryLike,
		);
	} catch (error: unknown) {
		throw normalize_remote_helper_error(error, "Command");
	}
}

/**
 * Factory for a remote form handler.
 *
 * @example
 * ```ts
 * export const SignIn = Form(signInSchema, ({ data, invalid }) =>
 *   Effect.gen(function* () {
 *     if (!data.email.includes("@")) {
 *       return yield* invalid.email("Use an email address.");
 *     }
 *
 *     return { email: data.email };
 *   })
 * );
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit form function.
 */
export function Form<A, E = never, R = never>(
	validate_or_handler: EffectLike<A, E, R> | RemoteFormHandler<void, A, E, R>,
): EffectRemoteForm<void, A, E>;
export function Form<Input extends RemoteFormInput, A, E = never, R = never>(
	validate_or_handler: "unchecked",
	maybe_handler: RemoteFormHandler<Input, A, E, R>,
): EffectRemoteForm<Input, A, E>;
export function Form<S extends Schema.Top, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteFormHandler<SchemaInput<S>, A, E, R>,
): EffectRemoteForm<FormSchemaEncodedInput<S>, A, E>;
export function Form<S extends StandardSchema, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteFormHandler<StandardSchemaOutput<S>, A, E, R>,
): EffectRemoteForm<FormStandardSchemaInput<S>, A, E>;
export function Form(validate_or_handler: unknown, maybe_handler?: unknown): unknown {
	try {
		if (maybe_handler) {
			return native_form(
				normalize_validator(validate_or_handler) as never,
				make_remote_form_wrapper(maybe_handler as RemoteFormHandler, "Form") as never,
			);
		}

		if (is_unchecked(validate_or_handler)) {
			throw new UncheckedFormHandlerMissingError();
		}

		const inputless_handler: RemoteFormHandler<void, unknown> = ({ data, invalid, issue }) => {
			if (is_handler(validate_or_handler)) {
				return validate_or_handler({ data, invalid, issue });
			}

			return validate_or_handler as EffectLike;
		};

		return native_form(
			make_remote_form_wrapper(inputless_handler, "Form") as never,
		) as unknown as ReturnType<typeof native_form>;
	} catch (error: unknown) {
		throw normalize_remote_helper_error(error, "Form");
	}
}

/**
 * Creates a prerenderable remote function from a no-argument Effect handler.
 *
 * @example
 * ```ts
 * export const GetBuildInfo = Prerender(() => Effect.succeed("ready"));
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - Effect value or no-argument handler to run at
 *   prerender time.
 * @param maybe_options - Optional prerender inputs and dynamic fallback
 *   configuration.
 * @returns A prerender function that yields an Effect when called.
 */
export function Prerender<A, E = never, R = never>(
	validate_or_handler: EffectLike<A, E, R> | RemoteHandler<void, A, E, R>,
	maybe_options?: PrerenderOptions<void>,
): EffectRemotePrerenderFunction<void, A, E>;

/**
 * Creates a prerenderable remote function with unchecked input.
 *
 * @example
 * ```ts
 * export const GetPost = Prerender(
 *   "unchecked",
 *   (slug: string) => Effect.succeed({ slug }),
 *   { inputs: () => Effect.succeed(["intro"]) },
 * );
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - `"unchecked"` sentinel that skips runtime input
 *   validation.
 * @param maybe_handler - Handler that receives the caller-provided input.
 * @param maybe_options - Optional prerender inputs and dynamic fallback
 *   configuration.
 * @returns A prerender function that yields an Effect when called with input.
 */
export function Prerender<Input, A, E = never, R = never>(
	validate_or_handler: "unchecked",
	maybe_handler: RemoteHandler<Input, A, E, R>,
	maybe_options?: PrerenderOptions<Input>,
): EffectRemotePrerenderFunction<Input, A, E>;

/**
 * Creates a prerenderable remote function validated with an Effect Schema.
 *
 * @example
 * ```ts
 * export const GetPost = Prerender(
 *   Schema.String,
 *   (slug) => Effect.succeed({ slug }),
 *   { inputs: () => Effect.succeed(["intro"]) },
 * );
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - Effect Schema used to decode and validate
 *   caller input before the handler runs.
 * @param maybe_handler - Handler that receives the decoded schema output.
 * @param maybe_options - Optional prerender inputs and dynamic fallback
 *   configuration.
 * @returns A prerender function whose caller input is the schema encoded type.
 */
export function Prerender<S extends Schema.Schema<unknown>, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteHandler<SchemaInput<S>, A, E, R>,
	maybe_options?: PrerenderOptions<SchemaEncodedInput<S>>,
): EffectRemotePrerenderFunction<SchemaEncodedInput<S>, A, E>;

/**
 * Creates a prerenderable remote function validated with a Standard Schema.
 *
 * @example
 * ```ts
 * export const GetPost = Prerender(
 *   standard_schema,
 *   (post) => Effect.succeed(post.slug),
 *   { dynamic: true },
 * );
 * ```
 *
 * @since 3.0.0
 * @param validate_or_handler - Standard Schema used to validate caller input
 *   before the handler runs.
 * @param maybe_handler - Handler that receives the decoded schema output.
 * @param maybe_options - Optional prerender inputs and dynamic fallback
 *   configuration.
 * @returns A prerender function whose caller input is the schema input type.
 */
export function Prerender<S extends StandardSchema, A, E = never, R = never>(
	validate_or_handler: S,
	maybe_handler: RemoteHandler<StandardSchemaOutput<S>, A, E, R>,
	maybe_options?: PrerenderOptions<StandardSchemaInput<S>>,
): EffectRemotePrerenderFunction<StandardSchemaInput<S>, A, E>;
export function Prerender(
	validate_or_handler: unknown,
	maybe_handler_or_options?: unknown,
	maybe_options?: PrerenderOptions<unknown>,
	native_factory: typeof native_prerender = native_prerender,
): unknown {
	try {
		if (is_handler(maybe_handler_or_options)) {
			return to_effect_prerender(
				native_factory(
					normalize_validator(validate_or_handler) as never,
					make_remote_wrapper(maybe_handler_or_options, "Prerender") as never,
					normalize_prerender_options(maybe_options) as never,
				) as NativeQueryLike,
			);
		}

		if (is_unchecked(validate_or_handler)) {
			throw new UncheckedPrerenderHandlerMissingError();
		}

		return to_effect_prerender(
			native_factory(
				make_remote_wrapper(validate_or_handler as RemoteHandler, "Prerender") as never,
				normalize_prerender_options(
					maybe_handler_or_options as PrerenderOptions<void> | undefined,
				) as never,
			) as NativeQueryLike,
		);
	} catch (error: unknown) {
		throw normalize_remote_helper_error(error, "Prerender");
	}
}
