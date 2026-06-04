import {
  command as native_command,
  form as native_form,
  getRequestEvent as get_native_request_event,
  prerender as native_prerender,
  query as native_query,
} from "$app/server";
import { copy_property_descriptors } from "$/internal/descriptors.ts";
import { normalize_remote_helper_error } from "$/remote/server.ts";
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
  EffectRemoteLiveQuery,
  EffectRemoteLiveQueryFunction,
  EffectRemoteLiveSource,
  EffectRemoteQuery,
  EffectRemoteQueryFunction,
  PrerenderOptions,
  RemoteFormHandler,
  RemoteHandler,
  SchemaInput,
} from "./types.ts";

type FormSchemaEncodedInput<S> = S extends Schema.Top
  ? S["Encoded"] extends RemoteFormInput ? S["Encoded"]
  : never
  : never;

type NativeQueryLike<Input = unknown> = (input: Input) => unknown;

type EffectRemoteResource<Output> =
  | EffectRemoteLiveQuery<Output>
  | EffectRemoteQuery<Output>;

type RemoteLiveHandler<Input = unknown, A = unknown> =
  | EffectLike<EffectRemoteLiveSource<A>>
  | EffectRemoteLiveSource<A>
  | ((input: Input) =>
    | EffectLike<EffectRemoteLiveSource<A>>
    | EffectRemoteLiveSource<A>);

interface QueryFactory {
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

  readonly batch: typeof QueryBatch;
  readonly live: typeof QueryLive;
}

function to_effect_query<Input, Output>(
  native: NativeQueryLike<Input>,
): EffectRemoteQueryFunction<Input, Output> {
  const wrapped = ((input: Input) => {
    if (is_current_remote_request()) {
      return (native as (input: Input) => unknown)(input);
    }

    const resource = (native as (input: Input) => unknown)(input);
    const effect = Effect.tryPromise({
      try: () => Promise.resolve(resource),
      catch: (error: unknown) => error,
    }) as unknown as EffectRemoteQuery<Output>;

    attach_query_resource_methods(resource, effect);

    return effect;
  }) as unknown as EffectRemoteQueryFunction<Input, Output>;

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

function to_effect_live_query<Input, Output>(
  native: NativeQueryLike<Input>,
): EffectRemoteLiveQueryFunction<Input, Output> {
  const wrapped = ((input: Input) => {
    const resource = (native as (input: Input) => unknown)(input);
    const effect = Effect.tryPromise({
      try: () => Promise.resolve(resource),
      catch: (error: unknown) => error,
    }) as unknown as EffectRemoteLiveQuery<Output>;

    attach_live_resource_methods(resource, effect);

    return effect;
  }) as unknown as EffectRemoteLiveQueryFunction<Input, Output>;

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

function attach_remote_resource_getters<Output>(
  resource: unknown,
  effect: EffectRemoteResource<Output>,
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

function attach_query_resource_methods<Output>(
  resource: unknown,
  effect: EffectRemoteQuery<Output>,
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
  effect: EffectRemoteLiveQuery<Output>,
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
function QueryRoot<A>(
  validate_or_handler: EffectLike<A> | RemoteHandler<void, A>,
): EffectRemoteQueryFunction<void, A>;
function QueryRoot<Input, A>(
  validate_or_handler: "unchecked",
  maybe_handler: RemoteHandler<Input, A>,
): EffectRemoteQueryFunction<Input, A>;
function QueryRoot<S extends Schema.Schema<unknown>, A>(
  validate_or_handler: S,
  maybe_handler: RemoteHandler<SchemaInput<S>, A>,
): EffectRemoteQueryFunction<SchemaInput<S>, A>;
function QueryRoot(
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
 * Factory for a batched read-only remote query function.
 *
 * @since 2.0.0
 * @param validate_or_handler - A schema or `"unchecked"` sentinel.
 * @param maybe_handler - Handler receiving validated inputs as one batch.
 * @returns A SvelteKit batch query function.
 */
function QueryBatch<Input, A>(
  validate_or_handler: "unchecked",
  maybe_handler: EffectRemoteBatchHandler<Input, A>,
): EffectRemoteQueryFunction<Input, A>;
function QueryBatch<S extends Schema.Schema<unknown>, A>(
  validate_or_handler: S,
  maybe_handler: EffectRemoteBatchHandler<SchemaInput<S>, A>,
): EffectRemoteQueryFunction<SchemaInput<S>, A>;
function QueryBatch(
  validate_or_handler: unknown,
  maybe_handler?: EffectRemoteBatchHandler,
): unknown {
  try {
    if (!maybe_handler) {
      throw new Error("Query.batch requires a handler");
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
function QueryLive<A>(
  validate_or_handler: RemoteLiveHandler<void, A>,
): EffectRemoteLiveQueryFunction<void, A>;
function QueryLive<Input, A>(
  validate_or_handler: "unchecked",
  maybe_handler: RemoteLiveHandler<Input, A>,
): EffectRemoteLiveQueryFunction<Input, A>;
function QueryLive<S extends Schema.Schema<unknown>, A>(
  validate_or_handler: S,
  maybe_handler: RemoteLiveHandler<SchemaInput<S>, A>,
): EffectRemoteLiveQueryFunction<SchemaInput<S>, A>;
function QueryLive(
  validate_or_handler: unknown,
  maybe_handler?: RemoteLiveHandler,
): unknown {
  try {
    if (maybe_handler) {
      return to_effect_live_query(native_query.live(
        normalize_validator(validate_or_handler) as never,
        make_remote_live_wrapper(
          maybe_handler,
          "Query.live",
        ) as never,
      ) as NativeQueryLike);
    }

    if (is_unchecked(validate_or_handler)) {
      throw new Error("Query.live('unchecked', handler) requires a handler");
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
export function Command<A>(
  validate_or_handler: EffectLike<A> | RemoteHandler<void, A>,
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
export function Form<S extends Schema.Top, A>(
  validate_or_handler: S,
  maybe_handler: RemoteFormHandler<SchemaInput<S>, A>,
): EffectRemoteForm<FormSchemaEncodedInput<S>, A>;
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
