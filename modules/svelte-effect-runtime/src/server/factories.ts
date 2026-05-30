import {
  command as native_command,
  form as native_form,
  prerender as native_prerender,
  query as native_query,
} from "$app/server";
import { copy_property_descriptors } from "$/internal/descriptors.ts";
import { normalize_remote_helper_error } from "$/remote/server.ts";
import type { RemoteFormInput } from "@sveltejs/kit";
import { Effect, type Schema } from "effect";

import { is_handler, is_unchecked, normalize_validator } from "./schema.ts";
import { make_remote_form_wrapper, make_remote_wrapper } from "./wrappers.ts";
import type {
  EffectLike,
  EffectRemoteCommand,
  EffectRemoteForm,
  EffectRemoteQuery,
  EffectRemoteQueryFunction,
  PrerenderOptions,
  RemoteFormHandler,
  RemoteHandler,
  SchemaInput,
} from "./types.ts";

type FormSchemaInput<S> = SchemaInput<S> extends RemoteFormInput
  ? SchemaInput<S>
  : never;

function to_effect_query<Input, Output>(
  native: ReturnType<typeof native_query>,
): ReturnType<typeof native_query> {
  const wrapped = ((input: Input) => {
    const resource = (native as (input: Input) => unknown)(input);
    const effect = Effect.tryPromise({
      try: () => Promise.resolve(resource),
      catch: (error: unknown) => error,
    }) as unknown as EffectRemoteQuery<Output>;

    attach_query_resource_methods(resource, effect);

    return effect;
  }) as unknown as ReturnType<
    typeof native_query
  >;

  copy_property_descriptors(native, wrapped);

  return wrapped;
}

type NativeQueryResource<Output> = {
  readonly refresh?: () => Promise<void>;
  readonly set?: (value: Output) => void;
  readonly withOverride?: (update: (current: Output) => Output) => unknown;
};

function is_query_resource<Output>(
  resource: unknown,
): resource is NativeQueryResource<Output> {
  const resource_type = typeof resource;

  return (
    (resource_type === "object" && resource !== null) ||
    resource_type === "function"
  );
}

function attach_query_resource_methods<Output>(
  resource: unknown,
  effect: EffectRemoteQuery<Output>,
): void {
  const methods = is_query_resource<Output>(resource) ? resource : undefined;
  const refresh = methods?.refresh;
  const set = methods?.set;
  const with_override = methods?.withOverride;

  if (!methods) {
    return;
  }

  if (typeof refresh === "function") {
    Object.defineProperty(effect, "refresh", {
      configurable: true,
      value: () =>
        Effect.tryPromise({
          try: () => Promise.resolve(refresh.call(resource)),
          catch: (error: unknown) => error,
        }),
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
      value: (update: (current: Output) => Output) =>
        with_override.call(resource, update),
    });
  }
}

/**
 * Factory for a read-only remote query function.
 *
 * @example
 * ```ts
 * export const getUser = Query(Schema.Struct({ id: Schema.String }), (input) =>
 *   Effect.succeed(input.id)
 * );
 * ```
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit query function.
 */
export function Query<A>(
  validate_or_handler: EffectLike<A>,
): EffectRemoteQueryFunction<void, A>;
export function Query<Input, A>(
  validate_or_handler: "unchecked",
  maybe_handler: RemoteHandler<Input, A>,
): EffectRemoteQueryFunction<Input, A>;
export function Query<S extends Schema.Schema<unknown>, A>(
  validate_or_handler: S,
  maybe_handler: RemoteHandler<SchemaInput<S>, A>,
): EffectRemoteQueryFunction<SchemaInput<S>, A>;
export function Query(
  validate_or_handler: unknown,
  maybe_handler?: RemoteHandler,
): unknown {
  try {
    if (maybe_handler) {
      return to_effect_query(native_query(
        normalize_validator(validate_or_handler) as never,
        make_remote_wrapper(maybe_handler, "Query") as never,
      ) as ReturnType<typeof native_query>);
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Query('unchecked', handler) requires a handler");
    }

    return to_effect_query(native_query(
      make_remote_wrapper(
        validate_or_handler as RemoteHandler,
        "Query",
      ) as never,
    ) as ReturnType<typeof native_query>);
  } catch (error: unknown) {
    throw normalize_remote_helper_error(error, "Query");
  }
}

/**
 * Factory for a write-oriented remote command function.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit command function.
 */
export function Command<A>(
  validate_or_handler: EffectLike<A>,
): EffectRemoteCommand<void, A>;
export function Command<Input, A>(
  validate_or_handler: "unchecked",
  maybe_handler: RemoteHandler<Input, A>,
): EffectRemoteCommand<Input, A>;
export function Command<S extends Schema.Schema<unknown>, A>(
  validate_or_handler: S,
  maybe_handler: RemoteHandler<SchemaInput<S>, A>,
): EffectRemoteCommand<SchemaInput<S>, A>;
export function Command(
  validate_or_handler: unknown,
  maybe_handler?: RemoteHandler,
): unknown {
  try {
    if (maybe_handler) {
      return native_command(
        normalize_validator(validate_or_handler) as never,
        make_remote_wrapper(maybe_handler, "Command") as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Command('unchecked', handler) requires a handler");
    }

    return native_command(
      make_remote_wrapper(
        validate_or_handler as RemoteHandler,
        "Command",
      ) as never,
    ) as ReturnType<typeof native_command>;
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
export function Form<A>(
  validate_or_handler: EffectLike<A> | RemoteFormHandler<void, A>,
): EffectRemoteForm<void, A>;
export function Form<Input extends RemoteFormInput, A>(
  validate_or_handler: "unchecked",
  maybe_handler: RemoteFormHandler<Input, A>,
): EffectRemoteForm<Input, A>;
export function Form<S extends Schema.Schema<unknown>, A>(
  validate_or_handler: S,
  maybe_handler: RemoteFormHandler<FormSchemaInput<S>, A>,
): EffectRemoteForm<FormSchemaInput<S>, A>;
export function Form(
  validate_or_handler: unknown,
  maybe_handler?: RemoteFormHandler<never, unknown>,
): unknown {
  try {
    if (maybe_handler) {
      return native_form(
        normalize_validator(validate_or_handler) as never,
        make_remote_form_wrapper(maybe_handler, "Form") as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Form('unchecked', handler) requires a handler");
    }

    const inputless_handler: RemoteFormHandler<void, unknown> = (
      { data, invalid, issue },
    ) => {
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
 * Factory for a prerenderable remote function.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler_or_options - Handler or prerender options.
 * @param maybe_options - Prerender options used with a validator.
 * @returns A SvelteKit prerender function.
 */
export function Prerender(
  validate_or_handler: unknown,
  maybe_handler_or_options?: RemoteHandler | PrerenderOptions,
  maybe_options?: PrerenderOptions,
): ReturnType<typeof native_prerender> {
  try {
    if (is_handler(maybe_handler_or_options)) {
      return native_prerender(
        normalize_validator(validate_or_handler) as never,
        make_remote_wrapper(maybe_handler_or_options, "Prerender") as never,
        maybe_options as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Prerender('unchecked', handler) requires a handler");
    }

    return native_prerender(
      make_remote_wrapper(
        validate_or_handler as RemoteHandler,
        "Prerender",
      ) as never,
      maybe_handler_or_options as never,
    ) as ReturnType<typeof native_prerender>;
  } catch (error: unknown) {
    throw normalize_remote_helper_error(error, "Prerender");
  }
}
