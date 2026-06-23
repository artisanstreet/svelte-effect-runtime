import {
  BatchQueryHandlerMissingError,
  UncheckedCommandHandlerMissingError,
  UncheckedFormHandlerMissingError,
  UncheckedLiveQueryHandlerMissingError,
  UncheckedPrerenderHandlerMissingError,
  UncheckedQueryHandlerMissingError,
} from "$/errors.ts";
import { copy_property_descriptors } from "$/internal/descriptors.ts";
import { normalize_remote_helper_error } from "$/remote/server.ts";
import {
  command as native_command,
  form as native_form,
  getRequestEvent as get_native_request_event,
  prerender as native_prerender,
  query as native_query,
} from "$app/server";
import type { RemoteFormInput } from "@sveltejs/kit";
import { Effect, type Schema } from "effect";

import { is_handler, is_unchecked, normalize_validator } from "./schema.ts";
import {
  is_running_remote_effect_handler,
  make_remote_form_wrapper,
  make_remote_live_wrapper,
  make_remote_wrapper,
} from "./wrappers.ts";
import type {
  EffectLike,
  EffectRemoteBatchHandler,
  EffectRemoteCommand,
  EffectRemoteForm,
  EffectRemoteFunction,
  EffectRemoteLiveQuery,
  EffectRemoteLiveQueryFunction,
  EffectRemoteLiveQueryResource,
  EffectRemoteQuery,
  EffectRemoteQueryFunction,
  PrerenderOptions,
  QueryFactory,
  RemoteFormHandler,
  RemoteHandler,
  RemoteLiveHandler,
  SchemaEncodedInput,
  SchemaInput,
  StandardSchema,
  StandardSchemaInput,
  StandardSchemaOutput,
} from "./types.ts";

type FormSchemaEncodedInput<S> = S extends Schema.Top
  ? FormRemoteInput<S["Encoded"]>
  : never;

type FormRemoteInput<Input> = NormalizeFormEncoded<Input> extends
  RemoteFormInput ? NormalizeFormEncoded<Input>
  : never;

type FormStandardSchemaInput<S> = StandardSchemaInput<S> extends RemoteFormInput
  ? StandardSchemaInput<S>
  : RemoteFormInput;

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

type NativeQueryLike<Input = unknown> = (input: Input) => unknown;

type EffectRemoteResource<Output, ErrorType = never> =
  | EffectRemoteLiveQueryResource<Output>
  | EffectRemoteQuery<Output, ErrorType>;

function to_effect_query<Input, Output, ErrorType = never>(
  native: NativeQueryLike<Input>,
): EffectRemoteQueryFunction<Input, Output, ErrorType> {
  const wrapped = ((input: Input) => {
    if (is_current_remote_request()) {
      return (native as (input: Input) => unknown)(input);
    }

    const resource = (native as (input: Input) => unknown)(input);
    const effect = Effect.tryPromise({
      try: () => Promise.resolve(resource),
      catch: (error: unknown) => error,
    }) as unknown as EffectRemoteQuery<Output, ErrorType>;

    attach_query_resource_methods(resource, effect);

    return effect;
  }) as unknown as EffectRemoteQueryFunction<Input, Output, ErrorType>;

  copy_property_descriptors(native, wrapped);

  return wrapped;
}

function is_current_remote_request(): boolean {
  if (is_running_remote_effect_handler()) {
    return false;
  }

  try {
    const event = get_native_request_event() as { isRemoteRequest?: boolean };

    return event.isRemoteRequest === true;
  } catch {
    return false;
  }
}

function to_effect_live_query<Input, Output, ErrorType = never>(
  native: NativeQueryLike<Input>,
): EffectRemoteLiveQueryFunction<Input, Output, ErrorType> {
  const wrapped = ((input: Input) => {
    const effect = Effect.try({
      try: () => {
        const resource = (native as (input: Input) => unknown)(input);

        return make_live_resource<Output>(resource);
      },
      catch: (error: unknown) => error,
    }) as unknown as EffectRemoteLiveQuery<Output, ErrorType>;

    return effect;
  }) as unknown as EffectRemoteLiveQueryFunction<
    Input,
    Output,
    ErrorType
  >;

  copy_property_descriptors(native, wrapped);

  return wrapped;
}

type NativeRemoteResource<Output> = {
  readonly current?: Output;
  readonly error?: unknown;
  readonly loading?: boolean;
  readonly ready?: boolean;
};

type NativeQueryResource<Output> = NativeRemoteResource<Output> & {
  readonly refresh?: () => Promise<void>;
  readonly set?: (value: Output) => void;
  readonly withOverride?: (update: (current: Output) => Output) => unknown;
};

type NativeLiveQueryResource<Output> =
  & NativeRemoteResource<Output>
  & Partial<AsyncIterable<Output>>
  & {
    readonly connected?: boolean;
    readonly done?: boolean;
    readonly reconnect?: () => Promise<void>;
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

function is_live_resource<Output>(
  resource: unknown,
): resource is NativeLiveQueryResource<Output> {
  const resource_type = typeof resource;

  return (
    (resource_type === "object" && resource !== null) ||
    resource_type === "function"
  );
}

function attach_remote_resource_getters<Output, ErrorType = never>(
  resource: unknown,
  effect: EffectRemoteResource<Output, ErrorType>,
): void {
  const methods = is_query_resource<Output>(resource) ? resource : undefined;
  const keys = ["current", "error", "loading", "ready"] as const;

  if (!methods) {
    return;
  }

  for (const key of keys) {
    if (!(key in methods)) {
      continue;
    }

    Object.defineProperty(effect, key, {
      configurable: true,
      get: () => methods[key],
    });
  }
}

function attach_query_resource_methods<Output, ErrorType = never>(
  resource: unknown,
  effect: EffectRemoteQuery<Output, ErrorType>,
): void {
  const methods = is_query_resource<Output>(resource) ? resource : undefined;
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

function attach_live_resource_methods<Output>(
  resource: unknown,
  effect: EffectRemoteLiveQueryResource<Output>,
): void {
  const methods = is_live_resource<Output>(resource) ? resource : undefined;
  const reconnect = methods?.reconnect;
  const async_iterator = methods?.[Symbol.asyncIterator];
  const keys = [
    "connected",
    "current",
    "done",
    "error",
    "loading",
    "ready",
  ] as const;

  if (!methods) {
    return;
  }

  for (const key of keys) {
    if (!(key in methods)) {
      continue;
    }

    Object.defineProperty(effect, key, {
      configurable: true,
      get: () => methods[key],
    });
  }

  if (typeof reconnect === "function") {
    Object.defineProperty(effect, "reconnect", {
      configurable: true,
      value: () =>
        Effect.tryPromise({
          try: () => Promise.resolve(reconnect.call(resource)),
          catch: (error: unknown) => error,
        }),
    });
  }

  if (typeof async_iterator === "function") {
    Object.defineProperty(effect, Symbol.asyncIterator, {
      configurable: true,
      value: () => async_iterator.call(resource),
    });
  }
}

function make_live_resource<Output>(
  resource: unknown,
): EffectRemoteLiveQueryResource<Output> {
  const live_resource = {} as EffectRemoteLiveQueryResource<Output>;

  attach_live_resource_methods(resource, live_resource);

  return live_resource;
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
function QueryRoot(
  validate_or_handler: unknown,
  maybe_handler?: unknown,
): unknown {
  try {
    if (maybe_handler) {
      return to_effect_query(native_query(
        normalize_validator(validate_or_handler) as never,
        make_remote_wrapper(maybe_handler as RemoteHandler, "Query") as never,
      ) as ReturnType<typeof native_query>);
    }

    if (is_unchecked(validate_or_handler)) {
      throw new UncheckedQueryHandlerMissingError();
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
 * Factory for a batched read-only remote query function.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema or `"unchecked"` sentinel.
 * @param maybe_handler - Handler receiving validated inputs as one batch.
 * @returns A SvelteKit batch query function.
 */
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
function QueryBatch(
  validate_or_handler: unknown,
  maybe_handler?: unknown,
): unknown {
  try {
    if (!maybe_handler) {
      throw new BatchQueryHandlerMissingError();
    }

    return to_effect_query(native_query.batch(
      normalize_validator(validate_or_handler) as never,
      make_remote_wrapper(
        maybe_handler as RemoteHandler,
        "Query.batch",
      ) as never,
    ) as NativeQueryLike);
  } catch (error: unknown) {
    throw normalize_remote_helper_error(error, "Query.batch");
  }
}

/**
 * Factory for a live remote query function.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg live handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit live query function.
 */
function QueryLive<A, E = never, R = never>(
  validate_or_handler: RemoteLiveHandler<void, A, E, R>,
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
function QueryLive(
  validate_or_handler: unknown,
  maybe_handler?: unknown,
): unknown {
  try {
    if (maybe_handler) {
      return to_effect_live_query(native_query.live(
        normalize_validator(validate_or_handler) as never,
        make_remote_live_wrapper(
          maybe_handler as RemoteLiveHandler,
          "Query.live",
        ) as never,
      ) as NativeQueryLike);
    }

    if (is_unchecked(validate_or_handler)) {
      throw new UncheckedLiveQueryHandlerMissingError();
    }

    return to_effect_live_query(native_query.live(
      make_remote_live_wrapper(
        validate_or_handler as RemoteLiveHandler,
        "Query.live",
      ) as never,
    ) as NativeQueryLike);
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
 * Factory for a write-oriented remote command function.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema, `"unchecked"`, or no-arg handler.
 * @param maybe_handler - Handler used when a validator is supplied.
 * @returns A SvelteKit command function.
 */
export function Command<A, E = never, R = never>(
  validate_or_handler: EffectLike<A, E, R> | RemoteHandler<void, A, E, R>,
): EffectRemoteCommand<void, A, E>;
export function Command<Input, A, E = never, R = never>(
  validate_or_handler: "unchecked",
  maybe_handler: RemoteHandler<Input, A, E, R>,
): EffectRemoteCommand<Input, A, E>;
export function Command<
  S extends Schema.Schema<unknown>,
  A,
  E = never,
  R = never,
>(
  validate_or_handler: S,
  maybe_handler: RemoteHandler<SchemaInput<S>, A, E, R>,
): EffectRemoteCommand<SchemaEncodedInput<S>, A, E>;
export function Command<S extends StandardSchema, A, E = never, R = never>(
  validate_or_handler: S,
  maybe_handler: RemoteHandler<StandardSchemaOutput<S>, A, E, R>,
): EffectRemoteCommand<StandardSchemaInput<S>, A, E>;
export function Command(
  validate_or_handler: unknown,
  maybe_handler?: unknown,
): unknown {
  try {
    if (maybe_handler) {
      return native_command(
        normalize_validator(validate_or_handler) as never,
        make_remote_wrapper(maybe_handler as RemoteHandler, "Command") as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new UncheckedCommandHandlerMissingError();
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
export function Form(
  validate_or_handler: unknown,
  maybe_handler?: unknown,
): unknown {
  try {
    if (maybe_handler) {
      return native_form(
        normalize_validator(validate_or_handler) as never,
        make_remote_form_wrapper(
          maybe_handler as RemoteFormHandler,
          "Form",
        ) as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new UncheckedFormHandlerMissingError();
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
export function Prerender<A, E = never, R = never>(
  validate_or_handler: EffectLike<A, E, R> | RemoteHandler<void, A, E, R>,
  maybe_options?: PrerenderOptions,
): EffectRemoteFunction<void, A, E>;
export function Prerender<Input, A, E = never, R = never>(
  validate_or_handler: "unchecked",
  maybe_handler: RemoteHandler<Input, A, E, R>,
  maybe_options?: PrerenderOptions,
): EffectRemoteFunction<Input, A, E>;
export function Prerender<
  S extends Schema.Schema<unknown>,
  A,
  E = never,
  R = never,
>(
  validate_or_handler: S,
  maybe_handler: RemoteHandler<SchemaInput<S>, A, E, R>,
  maybe_options?: PrerenderOptions,
): EffectRemoteFunction<SchemaEncodedInput<S>, A, E>;
export function Prerender<S extends StandardSchema, A, E = never, R = never>(
  validate_or_handler: S,
  maybe_handler: RemoteHandler<StandardSchemaOutput<S>, A, E, R>,
  maybe_options?: PrerenderOptions,
): EffectRemoteFunction<StandardSchemaInput<S>, A, E>;
export function Prerender(
  validate_or_handler: unknown,
  maybe_handler_or_options?: unknown,
  maybe_options?: PrerenderOptions,
): unknown {
  try {
    if (is_handler(maybe_handler_or_options)) {
      return native_prerender(
        normalize_validator(validate_or_handler) as never,
        make_remote_wrapper(maybe_handler_or_options, "Prerender") as never,
        maybe_options as never,
      );
    }

    if (is_unchecked(validate_or_handler)) {
      throw new UncheckedPrerenderHandlerMissingError();
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
