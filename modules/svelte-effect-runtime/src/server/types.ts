import type { RemoteQuery, RemoteQueryOverride } from "@sveltejs/kit";
import type { create_form_error, RemoteFailure } from "$/remote/shared.ts";
import type { Effect, Schema } from "effect";

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
  & Effect.Effect<A, RemoteFailure<unknown>, unknown>
  & Pick<RemoteQuery<A>, "set">
  & {
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
