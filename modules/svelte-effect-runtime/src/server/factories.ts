import {
  command as native_command,
  form as native_form,
  prerender as native_prerender,
  query as native_query,
} from "$app/server";
import { copy_property_descriptors } from "$/internal/descriptors.ts";
import { normalize_remote_helper_error } from "$/remote/server.ts";
import { Effect, type Schema } from "effect";

import { is_handler, is_unchecked, normalize_validator } from "./schema.ts";
import { make_remote_form_wrapper, make_remote_wrapper } from "./wrappers.ts";
import type {
  EffectLike,
  EffectRemoteCommand,
  EffectRemoteQuery,
  EffectRemoteQueryFunction,
  PrerenderOptions,
  RemoteFormHandler,
  RemoteHandler,
  SchemaInput,
} from "./types.ts";

const query_resource_keys = new Set<PropertyKey>([
  "refresh",
  "set",
  "withOverride",
]);

function to_effect_query<Input, Output>(
  native: ReturnType<typeof native_query>,
): ReturnType<typeof native_query> {
  const wrapped = ((input: Input) => {
    const resource = (native as (input: Input) => unknown)(input);
    const effect = Effect.tryPromise({
      try: () => Promise.resolve(resource),
      catch: (error: unknown) => error,
    }) as unknown as EffectRemoteQuery<Output>;

    copy_query_resource_descriptors(resource, effect);

    return effect;
  }) as unknown as ReturnType<
    typeof native_query
  >;

  copy_property_descriptors(native, wrapped);

  return wrapped;
}

function copy_query_resource_descriptors(
  resource: unknown,
  effect: object,
): void {
  if (typeof resource !== "object" && typeof resource !== "function") {
    return;
  }

  if (resource === null) {
    return;
  }

  for (const key of query_resource_keys) {
    const descriptor = Object.getOwnPropertyDescriptor(resource, key);

    if (!descriptor) {
      continue;
    }

    Object.defineProperty(effect, key, descriptor);
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
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit form function.
 */
export function Form(
  validate_or_handler: unknown,
  maybe_handler?: RemoteFormHandler,
): ReturnType<typeof native_form> {
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

    return native_form(
      make_remote_form_wrapper(
        (({ data, invalid, issue }) =>
          (validate_or_handler as RemoteFormHandler)({
            data,
            invalid,
            issue,
          })) as RemoteFormHandler,
        "Form",
      ) as never,
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
