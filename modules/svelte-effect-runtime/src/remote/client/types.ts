import type { RemoteForm, RemoteFormInput } from "@sveltejs/kit";
import type { RemoteFailure } from "$/remote/shared.ts";
import type { Effect } from "effect";

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
 * Represents the form submit handle passed into an Effect-aware enhanced
 * remote form callback.
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
export type EffectRemoteFormSubmit =
  & Effect.Effect<boolean, RemoteFailure<unknown>>
  & {
    updates: (
      ...updates: unknown[]
    ) => Effect.Effect<boolean, RemoteFailure<unknown>>;
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
> =
  & Omit<
    Parameters<RemoteForm<Input, unknown>["enhance"]>[0] extends (
      options: infer Options,
    ) => unknown ? Options
      : never,
    "submit"
  >
  & {
    submit: () => EffectRemoteFormSubmit;
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
  ErrorType = unknown,
> =
  & ((input: Input) => Effect.Effect<Output, RemoteFailure<ErrorType>>)
  & Omit<
    RemoteForm<Input, Output>,
    "enhance" | "for" | "preflight" | "submit" | "validate"
  >
  & {
    enhance(
      callback?: (
        options: EffectRemoteFormEnhanceOptions<Input>,
      ) => void | Promise<void> | Effect.Effect<void, unknown, unknown>,
    ): ReturnType<RemoteForm<Input, Output>["enhance"]>;
    for(id: Parameters<RemoteForm<Input, Output>["for"]>[0]): Omit<
      EffectRemoteForm<Input, Output, ErrorType>,
      "for"
    >;
    preflight(schema: unknown): EffectRemoteForm<Input, Output, ErrorType>;
    submit(input: Input): Effect.Effect<Output, RemoteFailure<ErrorType>>;
    validate(
      options?: Parameters<RemoteForm<Input, Output>["validate"]>[0],
    ): Effect.Effect<void, RemoteFailure<unknown>>;
  };
