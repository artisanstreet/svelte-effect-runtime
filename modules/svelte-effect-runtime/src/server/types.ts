import type { create_form_error, RemoteFailure } from "$/remote/shared.ts";
import type {
  RemoteFormInput,
  RemoteQuery,
  RemoteQueryOverride,
} from "@sveltejs/kit";
import type { EffectRemoteForm as ClientEffectRemoteForm } from "$/remote/client.ts";
import type { Effect, Schema, Stream } from "effect";

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
export type SchemaInput<S> = S extends Schema.Schema<infer Input> ? Input
  : unknown;

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
 * Effect-returning live query resource with SvelteKit live stream state and
 * reconnect controls preserved.
 *
 * @example
 * ```ts
 * const clock = getClock();
 * yield* clock.reconnect();
 *
 * for await (const value of clock) {
 *   console.log(value);
 * }
 * ```
 *
 * @since 2.0.0
 */
export type EffectRemoteLiveQuery<A> =
  & Effect.Effect<A, RemoteFailure<unknown>, never>
  & AsyncIterable<A>
  & {
    readonly connected: boolean;
    readonly current: A | undefined;
    readonly done: boolean;
    readonly error: unknown;
    readonly loading: boolean;
    readonly ready: boolean;
    readonly reconnect: () => Effect.Effect<void, unknown, never>;
  };

/**
 * Effect-returning remote live query function with SvelteKit live stream
 * properties preserved on the returned Effect.
 *
 * @example
 * ```ts
 * const clock = getClock();
 * yield* clock;
 * ```
 *
 * @since 2.0.0
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
