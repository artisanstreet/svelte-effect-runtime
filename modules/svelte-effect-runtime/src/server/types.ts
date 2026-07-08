import type { create_form_error, RemoteFailure } from "$/remote/shared.ts";
import type { RemoteFormInput, RemoteQuery, RemoteQueryOverride } from "@sveltejs/kit";
import type { EffectRemoteForm as ClientEffectRemoteForm } from "$/remote/client.ts";
import type { RemoteLiveStream } from "$/live.ts";
import type { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect";

/**
 * Effect-like values accepted by remote helper wrappers.
 *
 * @example
 * ```ts
 * const value: EffectLike<number> = Effect.succeed(1);
 * ```
 *
 * @since 2.0.0
 */
export type EffectLike<A = unknown, E = unknown, R = unknown> =
	| Effect.Effect<A, E, R>
	| Effect.gen.Return<A, E, R>;

/**
 * Handler shape accepted by query, command, and prerender helpers.
 *
 * @example
 * ```ts
 * const handler: RemoteHandler<{ id: string }, string> = ({ id }) =>
 *   Effect.succeed(id);
 * ```
 *
 * @since 2.0.0
 */
export type RemoteHandler<Input = unknown, A = unknown, E = unknown, R = unknown> = (
	input: Input,
) => EffectLike<A, E, R>;

/**
 * Source shape accepted by no-argument live query helpers.
 *
 * @example
 * ```ts
 * const source: RemoteLiveSource<number> = Stream.make(1, 2, 3);
 * ```
 *
 * @since 4.0.0
 */
export type RemoteLiveSource<A = unknown, E = unknown, R = unknown> = Stream.Stream<A, E, R>;

/**
 * Handler shape accepted by input-bearing live query helpers.
 *
 * @example
 * ```ts
 * const handler: RemoteLiveHandler<string, number> = (id) =>
 *   Stream.make(id.length);
 * ```
 *
 * @since 2.0.0
 */
export type RemoteLiveHandler<Input = unknown, A = unknown, E = unknown, R = unknown> = (
	input: Input,
) => Stream.Stream<A, E, R>;

/**
 * Handler shape accepted by batch query helpers. The handler receives the
 * validated inputs collected by SvelteKit and returns an Effect-producing
 * resolver for each requested input.
 *
 * @example
 * ```ts
 * const handler: EffectRemoteBatchHandler<string, boolean> = (ids) =>
 *   Effect.succeed((id) => ids.includes(id));
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteBatchHandler<Input = unknown, A = unknown, E = unknown, R = unknown> = (
	inputs: readonly Input[],
) => EffectLike<(input: Input, index: number) => A, E, R>;

/**
 * Handler shape accepted by the form helper.
 *
 * @example
 * ```ts
 * const handler: RemoteFormHandler<{ email: string }, { ok: true }> = (
 *   { data },
 * ) => Effect.succeed({ ok: data.email.length > 0 });
 * ```
 *
 * @since 2.0.0
 */
export type RemoteFormHandler<Input = unknown, A = unknown, E = unknown, R = unknown> = (input: {
	readonly data: Input;
	readonly invalid: FormInvalid<Input>;
	readonly issue: unknown;
}) => EffectLike<A, E, R>;

/**
 * Proxy callable used to create typed form validation failures.
 *
 * @example
 * ```ts
 * const fail: Effect.Effect<never, unknown> = invalid.email(
 *   "Use an email address.",
 * );
 * ```
 *
 * @since 2.0.0
 */
export type FormInvalid<Input = unknown> = FormInvalidFunctionChildren &
	FormInvalidChildren<Input> & {
		(message: string): Effect.Effect<never, ReturnType<typeof create_form_error>>;
	};

type FormInvalidFunctionChildren = {
	readonly apply: FormInvalid;
	readonly bind: FormInvalid;
	readonly call: FormInvalid;
	readonly length: FormInvalid;
	readonly name: FormInvalid;
	readonly toString: FormInvalid;
};

type FormInvalidChildren<Input> =
	IsUnknown<Input> extends true
		? {
				readonly [key: string]: FormInvalid;
			}
		: NonNullable<Input> extends readonly (infer Item)[]
			? {
					readonly [index: number]: FormInvalid<Item>;
				}
			: NonNullable<Input> extends object
				? {
						readonly [Key in keyof NonNullable<Input>]-?: FormInvalid<
							NonNullable<Input>[Key]
						>;
					}
				: Record<never, never>;

type IsUnknown<Value> = unknown extends Value ? ([Value] extends [unknown] ? true : false) : false;

/**
 * Options accepted by the prerender helper.
 *
 * @example
 * ```ts
 * const options: PrerenderOptions = {
 *   inputs: () => ["first-post", "second-post"],
 *   dynamic: true,
 * };
 * ```
 *
 * @since 2.0.0
 */
export type PrerenderOptions = {
	readonly inputs?: unknown;
	readonly dynamic?: boolean;
};

/**
 * Minimal Standard Schema shape accepted by SvelteKit remote helpers.
 *
 * @example
 * ```ts
 * const schema: StandardSchema = {
 *   "~standard": {
 *     validate: (input) => ({ value: input }),
 *   },
 * };
 * ```
 *
 * @since 2.0.0
 */
export type StandardSchema = {
	readonly "~standard": {
		readonly types?: {
			readonly input: unknown;
			readonly output: unknown;
		};
		readonly validate: (input: unknown) => unknown;
	};
};

/**
 * Extracts the input type from an Effect Schema.
 *
 * @example
 * ```ts
 * type Input = SchemaInput<typeof Schema.String>;
 * ```
 *
 * @since 2.0.0
 */
export type SchemaInput<S> = S extends Schema.Top ? Schema.Schema.Type<S> : unknown;

/**
 * Extracts the encoded caller input type from an Effect Schema.
 *
 * @example
 * ```ts
 * type Input = SchemaEncodedInput<typeof Schema.String>;
 * ```
 *
 * @since 2.4.2
 */
export type SchemaEncodedInput<S> = S extends Schema.Top ? S["Encoded"] : unknown;

/**
 * Extracts the encoded input type from a Standard Schema.
 *
 * @example
 * ```ts
 * type Input = StandardSchemaInput<typeof schema>;
 * ```
 *
 * @since 3.0.0
 */
export type StandardSchemaInput<S> = S extends {
	readonly "~standard": {
		readonly types: {
			readonly input: infer Input;
		};
	};
}
	? Input
	: unknown;

/**
 * Extracts the decoded handler input type from a Standard Schema.
 *
 * @example
 * ```ts
 * type Output = StandardSchemaOutput<typeof schema>;
 * ```
 *
 * @since 3.0.0
 */
export type StandardSchemaOutput<S> = S extends {
	readonly "~standard": {
		readonly types: {
			readonly output: infer Output;
		};
	};
}
	? Output
	: StandardSchemaInput<S>;

/**
 * Root and server export shape for building the server-side runtime.
 *
 * @example
 * ```ts
 * const runtime = ServerRuntime.make();
 * ```
 *
 * @since 2.0.0
 */
export interface ServerRuntimeFactory {
	/**
	 * Builds and caches the server-side Effect runtime.
	 *
	 * @param layer - Optional Effect layer to provide to remote handlers.
	 * @returns The managed runtime used by server-side SER helpers.
	 */
	make<R = never>(layer?: Layer.Layer<R>): ManagedRuntime.ManagedRuntime<R, never>;
}

/**
 * Root and server export shape for query helpers.
 *
 * @example
 * ```ts
 * export const GetUser = Query(Schema.Struct({ id: Schema.String }), ({ id }) =>
 *   Effect.succeed({ id })
 * );
 * ```
 *
 * @since 2.0.0
 */
export interface QueryFactory {
	<A, E = never, R = never>(
		validate_or_handler: EffectLike<A, E, R> | RemoteHandler<void, A, E, R>,
	): EffectRemoteQueryFunction<void, A, E>;
	<Input, A, E = never, R = never>(
		validate_or_handler: "unchecked",
		maybe_handler: RemoteHandler<Input, A, E, R>,
	): EffectRemoteQueryFunction<Input, A, E>;
	<S extends Schema.Schema<unknown>, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteHandler<SchemaInput<S>, A, E, R>,
	): EffectRemoteQueryFunction<SchemaEncodedInput<S>, A, E>;
	<S extends StandardSchema, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteHandler<StandardSchemaOutput<S>, A, E, R>,
	): EffectRemoteQueryFunction<StandardSchemaInput<S>, A, E>;

	readonly batch: QueryBatchFactory;
	readonly live: QueryLiveFactory;
}

/**
 * Root and server export shape for batched query helpers.
 *
 * @example
 * ```ts
 * export const HasUser = Query.batch(Schema.String, (ids) =>
 *   Effect.succeed((id) => ids.includes(id))
 * );
 * ```
 *
 * @since 2.0.0
 */
export interface QueryBatchFactory {
	<Input, A, E = never, R = never>(
		validate_or_handler: "unchecked",
		maybe_handler: EffectRemoteBatchHandler<Input, A, E, R>,
	): EffectRemoteQueryFunction<Input, A, E>;
	<S extends Schema.Schema<unknown>, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: EffectRemoteBatchHandler<SchemaInput<S>, A, E, R>,
	): EffectRemoteQueryFunction<SchemaEncodedInput<S>, A, E>;
	<S extends StandardSchema, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: EffectRemoteBatchHandler<StandardSchemaOutput<S>, A, E, R>,
	): EffectRemoteQueryFunction<StandardSchemaInput<S>, A, E>;
}

/**
 * Root and server export shape for live query helpers.
 *
 * @example
 * ```ts
 * export const Clock = Query.live(() => Stream.repeatValue(new Date()));
 * ```
 *
 * @since 2.0.0
 */
export interface QueryLiveFactory {
	<A, E = never, R = never>(
		validate_or_handler: RemoteLiveSource<A, E, R> | RemoteLiveHandler<void, A, E, R>,
	): EffectRemoteLiveQueryFunction<void, A, E>;
	<Input, A, E = never, R = never>(
		validate_or_handler: "unchecked",
		maybe_handler: RemoteLiveHandler<Input, A, E, R>,
	): EffectRemoteLiveQueryFunction<Input, A, E>;
	<S extends Schema.Schema<unknown>, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteLiveHandler<SchemaInput<S>, A, E, R>,
	): EffectRemoteLiveQueryFunction<SchemaEncodedInput<S>, A, E>;
	<S extends StandardSchema, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteLiveHandler<StandardSchemaOutput<S>, A, E, R>,
	): EffectRemoteLiveQueryFunction<StandardSchemaInput<S>, A, E>;
}

/**
 * Root and server export shape for command helpers.
 *
 * @example
 * ```ts
 * export const SaveUser = Command(
 *   Schema.Struct({ id: Schema.String }),
 *   ({ id }) => Effect.succeed({ id, saved: true }),
 * );
 * ```
 *
 * @since 2.0.0
 */
export interface CommandFactory {
	<A, E = never, R = never>(
		validate_or_handler: EffectLike<A, E, R> | RemoteHandler<void, A, E, R>,
	): EffectRemoteCommand<void, A, E>;
	<Input, A, E = never, R = never>(
		validate_or_handler: "unchecked",
		maybe_handler: RemoteHandler<Input, A, E, R>,
	): EffectRemoteCommand<Input, A, E>;
	<S extends Schema.Schema<unknown>, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteHandler<SchemaInput<S>, A, E, R>,
	): EffectRemoteCommand<SchemaEncodedInput<S>, A, E>;
	<S extends StandardSchema, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteHandler<StandardSchemaOutput<S>, A, E, R>,
	): EffectRemoteCommand<StandardSchemaInput<S>, A, E>;
}

/**
 * Root and server export shape for form helpers.
 *
 * @example
 * ```ts
 * export const SignIn = Form(
 *   Schema.Struct({ email: Schema.String }),
 *   ({ data }) => Effect.succeed({ ok: data.email.length > 0 }),
 * );
 * ```
 *
 * @since 2.0.0
 */
export interface FormFactory {
	<A, E = never, R = never>(
		validate_or_handler: EffectLike<A, E, R> | RemoteFormHandler<void, A, E, R>,
	): EffectRemoteForm<void, A, E>;
	<Input extends RemoteFormInput, A, E = never, R = never>(
		validate_or_handler: "unchecked",
		maybe_handler: RemoteFormHandler<Input, A, E, R>,
	): EffectRemoteForm<Input, A, E>;
	<S extends Schema.Top, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteFormHandler<SchemaInput<S>, A, E, R>,
	): EffectRemoteForm<FormSchemaEncodedInput<S>, A, E>;
	<S extends StandardSchema, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteFormHandler<StandardSchemaOutput<S>, A, E, R>,
	): EffectRemoteForm<FormStandardSchemaInput<S>, A, E>;
}

/**
 * Root and server export shape for prerender helpers.
 *
 * @example
 * ```ts
 * export const GetBuildInfo = Prerender(() => Effect.succeed("ready"));
 * ```
 *
 * @since 2.0.0
 */
export interface PrerenderFactory {
	<A, E = never, R = never>(
		validate_or_handler: EffectLike<A, E, R> | RemoteHandler<void, A, E, R>,
		maybe_options?: PrerenderOptions,
	): EffectRemoteFunction<void, A, E>;
	<Input, A, E = never, R = never>(
		validate_or_handler: "unchecked",
		maybe_handler: RemoteHandler<Input, A, E, R>,
		maybe_options?: PrerenderOptions,
	): EffectRemoteFunction<Input, A, E>;
	<S extends Schema.Schema<unknown>, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteHandler<SchemaInput<S>, A, E, R>,
		maybe_options?: PrerenderOptions,
	): EffectRemoteFunction<SchemaEncodedInput<S>, A, E>;
	<S extends StandardSchema, A, E = never, R = never>(
		validate_or_handler: S,
		maybe_handler: RemoteHandler<StandardSchemaOutput<S>, A, E, R>,
		maybe_options?: PrerenderOptions,
	): EffectRemoteFunction<StandardSchemaInput<S>, A, E>;
}

/**
 * Effect-returning remote function type exposed by query and prerender.
 *
 * @example
 * ```ts
 * type Post = { id: string };
 * const posts: Post[] = [];
 * const getPosts: EffectRemoteFunction<void, Post[]> = () =>
 *   Effect.succeed(posts);
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteFunction<Input, A, E = never> = [Input] extends [void]
	? () => Effect.Effect<A, RemoteFailure<E>, never>
	: undefined extends Input
		? (input?: Input) => Effect.Effect<A, RemoteFailure<E>, never>
		: (input: Input) => Effect.Effect<A, RemoteFailure<E>, never>;

/**
 * Effect-returning query resource with SvelteKit cache update methods
 * preserved.
 *
 * @example
 * ```ts
 * const posts = GetPosts();
 * yield* posts.refresh();
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteQuery<A, E = never> = Effect.Effect<A, RemoteFailure<E>, never> &
	Pick<RemoteQuery<A>, "set"> & {
		readonly current: A | undefined;
		readonly error: unknown;
		readonly loading: boolean;
		readonly ready: boolean;
		readonly refresh: () => Effect.Effect<void, unknown, never>;
		readonly withOverride: (update: (current: A) => A) => RemoteQueryOverride;
	};

/**
 * Effect-returning remote query function with SvelteKit query resource methods
 * preserved on the returned Effect.
 *
 * @example
 * ```ts
 * const posts = GetPosts();
 * yield* posts;
 * yield* posts.refresh();
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteQueryFunction<Input, A, E = never> = [Input] extends [void]
	? () => EffectRemoteQuery<A, E>
	: undefined extends Input
		? (input?: Input) => EffectRemoteQuery<A, E>
		: (input: Input) => EffectRemoteQuery<A, E>;

/**
 * Remote live query stream.
 *
 * @example
 * ```ts
 * const clock = getClock();
 * const first = yield* Stream.runHead(clock);
 * ```
 *
 * @since 4.0.0
 */
export type EffectRemoteLiveQuery<A, E = never> = RemoteLiveStream<A, E>;

/**
 * Remote live query function returning an Effect Stream.
 *
 * @example
 * ```ts
 * const clock = getClock();
 * ```
 *
 * @since 4.0.0
 */
export type EffectRemoteLiveQueryFunction<Input, A, E = never> = [Input] extends [void]
	? () => EffectRemoteLiveQuery<A, E>
	: undefined extends Input
		? (input?: Input) => EffectRemoteLiveQuery<A, E>
		: (input: Input) => EffectRemoteLiveQuery<A, E>;

/**
 * Effect-returning command type with SvelteKit's pending counter preserved.
 *
 * @example
 * ```ts
 * const upvote: EffectRemoteCommand<string, number> = Object.assign(
 *   (id: string) => Effect.succeed(id.length),
 *   { pending: 0 },
 * );
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteCommand<Input, A, E = never> = EffectRemoteFunction<Input, A, E> & {
	readonly pending: number;
};

/**
 * Effect-returning form type with SvelteKit form helpers preserved.
 *
 * @example
 * ```ts
 * const signIn: EffectRemoteForm<{ email: string }, { ok: true }> =
 *   Form(Schema.Struct({ email: Schema.String }), ({ data }) =>
 *     Effect.succeed({ ok: data.email.length > 0 })
 *   );
 * ```
 *
 * @since 2.0.0
 * @template Input - Data shape submitted by the remote form.
 * @template A - Successful value produced by the form handler.
 */
export type EffectRemoteForm<
	Input extends RemoteFormInput | void,
	A,
	E = never,
> = ClientEffectRemoteForm<Input, A, E>;

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
