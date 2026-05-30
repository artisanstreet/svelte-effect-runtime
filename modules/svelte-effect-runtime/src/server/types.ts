import type { create_form_error } from "$/remote/shared.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
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
 * @since 2.0.0
 */
export type EffectRemoteFunction<Input, A> = undefined extends Input
  ? (input?: Input) => Effect.Effect<A, RemoteFailure<unknown>, unknown>
  : (input: Input) => Effect.Effect<A, RemoteFailure<unknown>, unknown>;

/**
 * Effect-returning command type with SvelteKit's pending counter preserved.
 *
 * @since 2.0.0
 */
export type EffectRemoteCommand<Input, A> =
  & EffectRemoteFunction<Input, A>
  & {
    readonly pending: number;
  };
