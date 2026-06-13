import type { create_form_error, RemoteFailure } from "$/remote/shared.ts";
import type {
  RemoteFormInput,
  RemoteQuery,
  RemoteQueryOverride,
} from "@sveltejs/kit";
import type { EffectRemoteForm as ClientEffectRemoteForm } from "$/remote/client.ts";
import type { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect";

/**
 * Effect-like values accepted by remote helper wrappers.
 *
 * @since 2.0.0
 */
export type EffectLike<A = unknown> =
  | Effect.Effect<A, unknown, unknown>
  | Effect.gen.Return<A, unknown, unknown>;

/**
 * Handler shape accepted by query, command, and prerender helpers.
 *
 * @since 2.0.0
 */
export type RemoteHandler<Input = unknown, A = unknown> = (
  input: Input,
) => EffectLike<A>;

/**
 * Handler or source shape accepted by live query helpers.
 *
 * @since 2.0.0
 */
export type RemoteLiveHandler<Input = unknown, A = unknown> =
  | EffectLike<EffectRemoteLiveSource<A>>
  | EffectRemoteLiveSource<A>
  | ((input: Input) =>
    | EffectLike<EffectRemoteLiveSource<A>>
    | EffectRemoteLiveSource<A>);

/**
 * Handler shape accepted by batch query helpers. The handler receives the
 * validated inputs collected by SvelteKit and returns an Effect-producing
 * resolver for each requested input.
 *
 * @since 2.0.0
 */
export type EffectRemoteBatchHandler<Input = unknown, A = unknown> = (
  inputs: readonly Input[],
) => EffectLike<(input: Input, index: number) => A>;

/**
 * Handler shape accepted by the form helper.
 *
 * @since 2.0.0
 */
export type RemoteFormHandler<Input = unknown, A = unknown> = (
  input: {
    readonly data: Input;
    readonly invalid: FormInvalid;
    readonly issue: unknown;
  },
) => EffectLike<A>;

/**
 * Proxy callable used to create typed form validation failures.
 *
 * @since 2.0.0
 */
export type FormInvalid =
  & {
    readonly [key: string]: FormInvalid;
  }
  & ((
    message: string,
  ) => Effect.Effect<never, ReturnType<typeof create_form_error>>);

/**
 * Options accepted by the prerender helper.
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
 * @since 2.0.0
 */
export type StandardSchema = {
  readonly "~standard": {
    readonly validate: (input: unknown) => unknown;
  };
};

/**
 * Extracts the input type from an Effect Schema.
 *
 * @since 2.0.0
 */
export type SchemaInput<S> = S extends Schema.Top ? Schema.Schema.Type<S>
  : unknown;

/**
 * Root and server export shape for building the server-side runtime.
 *
 * @since 2.0.0
 */
export interface ServerRuntimeFactory {
  make<R = never>(
    layer?: Layer.Layer<R>,
  ): ManagedRuntime.ManagedRuntime<R, never>;
}

/**
 * Root and server export shape for query helpers.
 *
 * @since 2.0.0
 */
export interface QueryFactory {
  <A>(
    validate_or_handler: EffectLike<A> | RemoteHandler<void, A>,
  ): EffectRemoteQueryFunction<void, A>;
  <Input, A>(
    validate_or_handler: "unchecked",
    maybe_handler: RemoteHandler<Input, A>,
  ): EffectRemoteQueryFunction<Input, A>;
  <S extends Schema.Schema<unknown>, A>(
    validate_or_handler: S,
    maybe_handler: RemoteHandler<SchemaInput<S>, A>,
  ): EffectRemoteQueryFunction<SchemaInput<S>, A>;

  readonly batch: QueryBatchFactory;
  readonly live: QueryLiveFactory;
}

/**
 * Root and server export shape for batched query helpers.
 *
 * @since 2.0.0
 */
export interface QueryBatchFactory {
  <Input, A>(
    validate_or_handler: "unchecked",
    maybe_handler: EffectRemoteBatchHandler<Input, A>,
  ): EffectRemoteQueryFunction<Input, A>;
  <S extends Schema.Schema<unknown>, A>(
    validate_or_handler: S,
    maybe_handler: EffectRemoteBatchHandler<SchemaInput<S>, A>,
  ): EffectRemoteQueryFunction<SchemaInput<S>, A>;
}

/**
 * Root and server export shape for live query helpers.
 *
 * @since 2.0.0
 */
export interface QueryLiveFactory {
  <A>(
    validate_or_handler: RemoteLiveHandler<void, A>,
  ): EffectRemoteLiveQueryFunction<void, A>;
  <Input, A>(
    validate_or_handler: "unchecked",
    maybe_handler: RemoteLiveHandler<Input, A>,
  ): EffectRemoteLiveQueryFunction<Input, A>;
  <S extends Schema.Schema<unknown>, A>(
    validate_or_handler: S,
    maybe_handler: RemoteLiveHandler<SchemaInput<S>, A>,
  ): EffectRemoteLiveQueryFunction<SchemaInput<S>, A>;
}

/**
 * Root and server export shape for command helpers.
 *
 * @since 2.0.0
 */
export interface CommandFactory {
  <A>(
    validate_or_handler: EffectLike<A> | RemoteHandler<void, A>,
  ): EffectRemoteCommand<void, A>;
  <Input, A>(
    validate_or_handler: "unchecked",
    maybe_handler: RemoteHandler<Input, A>,
  ): EffectRemoteCommand<Input, A>;
  <S extends Schema.Schema<unknown>, A>(
    validate_or_handler: S,
    maybe_handler: RemoteHandler<SchemaInput<S>, A>,
  ): EffectRemoteCommand<SchemaInput<S>, A>;
}

/**
 * Root and server export shape for form helpers.
 *
 * @since 2.0.0
 */
export interface FormFactory {
  <A>(
    validate_or_handler: EffectLike<A> | RemoteFormHandler<void, A>,
  ): EffectRemoteForm<void, A>;
  <Input extends RemoteFormInput, A>(
    validate_or_handler: "unchecked",
    maybe_handler: RemoteFormHandler<Input, A>,
  ): EffectRemoteForm<Input, A>;
  <S extends Schema.Top, A>(
    validate_or_handler: S,
    maybe_handler: RemoteFormHandler<SchemaInput<S>, A>,
  ): EffectRemoteForm<FormSchemaEncodedInput<S>, A>;
}

/**
 * Root and server export shape for prerender helpers.
 *
 * @since 2.0.0
 */
export interface PrerenderFactory {
  (
    validate_or_handler: unknown,
    maybe_handler_or_options?: RemoteHandler | PrerenderOptions,
    maybe_options?: PrerenderOptions,
  ): unknown;
}

/**
 * Source values accepted by live query helpers.
 *
 * @example
 * ```ts
 * const source: EffectRemoteLiveSource<number> = Stream.make(1, 2, 3);
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteLiveSource<A> =
  | Stream.Stream<A, unknown, unknown>
  | AsyncIterable<A>
  | AsyncIterator<A>
  | Iterable<A>
  | Iterator<A>;

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
export type EffectRemoteFunction<Input, A> = [Input] extends [void]
  ? () => Effect.Effect<A, RemoteFailure<unknown>, unknown>
  : undefined extends Input
    ? (input?: Input) => Effect.Effect<A, RemoteFailure<unknown>, unknown>
  : (input: Input) => Effect.Effect<A, RemoteFailure<unknown>, unknown>;

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
export type EffectRemoteQuery<A> =
  & Effect.Effect<A, RemoteFailure<unknown>, never>
  & Pick<RemoteQuery<A>, "set">
  & {
    readonly current: A | undefined;
    readonly error: unknown;
    readonly loading: boolean;
    readonly ready: boolean;
    readonly refresh: () => Effect.Effect<void, unknown, never>;
    readonly withOverride: (
      update: (current: A) => A,
    ) => RemoteQueryOverride;
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
export type EffectRemoteQueryFunction<Input, A> = [Input] extends [void]
  ? () => EffectRemoteQuery<A>
  : undefined extends Input ? (input?: Input) => EffectRemoteQuery<A>
  : (input: Input) => EffectRemoteQuery<A>;

/**
 * Live query resource with SvelteKit live stream state and reconnect controls
 * preserved.
 *
 * @example
 * ```ts
 * const clock = yield* getClock();
 * yield* clock.reconnect();
 *
 * for await (const value of clock) {
 *   console.log(value);
 * }
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteLiveQueryResource<A> =
  & {
    readonly connected: boolean;
    readonly current: A | undefined;
    readonly done: boolean;
    readonly error: unknown;
    readonly loading: boolean;
    readonly ready: boolean;
    readonly reconnect: () => Effect.Effect<void, unknown, never>;
  }
  & AsyncIterable<A>;

/**
 * Effect-returning live query whose yielded value is the live resource.
 *
 * @example
 * ```ts
 * const clock = yield* getClock();
 * const current = clock.current;
 * ```
 *
 * @since 2.2.0
 */
export type EffectRemoteLiveQuery<A> = Effect.Effect<
  EffectRemoteLiveQueryResource<A>,
  RemoteFailure<unknown>,
  never
>;

/**
 * Effect-returning remote live query function with SvelteKit live stream
 * properties preserved on the returned Effect.
 *
 * @example
 * ```ts
 * const clock = yield* getClock();
 * ```
 *
 * @since 2.2.0
 */
export type EffectRemoteLiveQueryFunction<Input, A> = [Input] extends [void]
  ? () => EffectRemoteLiveQuery<A>
  : undefined extends Input ? (input?: Input) => EffectRemoteLiveQuery<A>
  : (input: Input) => EffectRemoteLiveQuery<A>;

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
export type EffectRemoteCommand<Input, A> =
  & EffectRemoteFunction<Input, A>
  & {
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
export type EffectRemoteForm<Input extends RemoteFormInput | void, A> =
  ClientEffectRemoteForm<Input, A>;

type FormSchemaEncodedInput<S> = S extends Schema.Top
  ? FormRemoteInput<S["Encoded"]>
  : never;

type FormRemoteInput<Input> = NormalizeFormEncoded<Input> extends
  RemoteFormInput ? NormalizeFormEncoded<Input>
  : never;

type FormScalar = string | number | boolean | File;

type NormalizeFormEncoded<Value> = Value extends FormScalar ? Value
  : Value extends ReadonlyArray<infer Item> ? Array<NormalizeFormEncoded<Item>>
  : Value extends object ? NormalizeFormObject<Value>
  : Value;

type NormalizeFormObject<Value> = {
  readonly [Key in keyof Value]: Key extends OptionalFormKeys<Value>
    ? NormalizeFormEncoded<Exclude<Value[Key], undefined>>
    : NormalizeFormEncoded<Value[Key]>;
};

type OptionalFormKeys<Value> = {
  [Key in keyof Value]-?: Record<PropertyKey, never> extends Pick<Value, Key>
    ? Key
    : never;
}[keyof Value];
