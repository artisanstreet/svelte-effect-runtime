/**
 * v3 server-side entrypoint for `svelte-effect-runtime`.
 *
 * Implements the Effect-aware wrappers around SvelteKit's remote-function
 * primitives (`query`, `command`, `form`, `prerender`) together with the
 * `ServerRuntime` builder and the `RequestEvent` service tag. Applications
 * rarely import this module directly — the Vite plugin rewrites imports
 * inside `.remote.ts` files to resolve here automatically.
 *
 * @example
 * ```ts
 * import { Query, ServerRuntime } from "svelte-effect-runtime/v3/_server";
 * import { Effect, Schema } from "effect";
 *
 * ServerRuntime.make();
 *
 * export const hello = Query(Schema.String, (name) =>
 *   Effect.succeed(`hello ${name}`)
 * );
 * ```
 *
 * @see https://ser.barekey.dev/content/reference/server-runtime
 *
 * @module
 */
import {
  error as svelte_error,
  invalid as svelte_invalid,
} from "@sveltejs/kit";
import type {
  RemoteForm as SvelteKitRemoteForm,
  RemoteFormInput as SvelteKitRemoteFormInput,
} from "@sveltejs/kit";
import {
  command as native_command,
  form as native_form,
  getRequestEvent as get_native_request_event,
  prerender as native_prerender,
  query as native_query,
} from "$app/server";
import { get_request_store } from "@sveltejs/kit/internal/server";
import * as devalue from "devalue";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";
import type { Context } from "effect";
import {
  create_form_error,
  create_remote_http_error,
  create_serialized_remote_failure_envelope,
  type FormError,
  is_form_error,
} from "$internal/remote-shared.ts";
import {
  get_cause_failure,
  get_effect_schema_field_names,
  make_context_key,
  to_standard_schema_v1,
  to_transportable_data,
} from "$internal/effect-compat.ts";

type EffectSchema = Schema.Schema.Any;

/**
 * Single entry in a {@link Transport} table. Describes how to encode a value
 * of type `T` to a wire payload and decode it back.
 *
 * @see https://ser.barekey.dev/content/reference/transport
 */
export interface Transporter<T = unknown, U = { value: unknown }> {
  /** Restore the original value from the wire payload. */
  decode: (data: U) => T;
  /**
   * Encode the value to a wire payload, or return `false` when this transporter
   * does not apply to the supplied value.
   */
  encode: (value: T) => false | U;
}

/**
 * Named collection of {@link Transporter}s, passed to devalue so custom types
 * survive the client/server round-trip.
 *
 * @see https://ser.barekey.dev/content/reference/transport
 */
export type Transport = Record<string, Transporter>;

/** Alias for SvelteKit's native remote-form input shape. */
export type RemoteFormInput = SvelteKitRemoteFormInput;

/** SvelteKit's native `query` function signature, re-exported for typing. */
export type RemoteQueryFunction<Input, Output> = (
  arg: OptionalArgument<Input>,
) => Promise<Output>;

/** SvelteKit's native `command` shape, re-exported for typing. */
export type RemoteCommand<Input, Output> =
  & ((
    arg: OptionalArgument<Input>,
  ) => Promise<Output> & {
    updates(...updates: Array<unknown>): Promise<Output>;
  })
  & {
    readonly pending: number;
  };

/** SvelteKit's native `prerender` function signature, re-exported for typing. */
export type RemotePrerenderFunction<Input, Output> = (
  arg: OptionalArgument<Input>,
) => Promise<Output>;

/** SvelteKit's native `form` shape, re-exported for typing. */
export type RemoteForm<Input extends RemoteFormInput | void, Output> =
  SvelteKitRemoteForm<Input, Output>;

type RuntimeOperator = (
  self: Layer.Layer<unknown, unknown, unknown>,
) => Layer.Layer<unknown, unknown, unknown>;

type RuntimeSeedLayer<Requirements> = Layer.Layer<
  Requirements,
  never,
  Requirements
>;

type ProvidedBy<Op> = Op extends (
  self: RuntimeSeedLayer<infer Requirements>,
) => Layer.Layer<unknown, unknown, infer Incoming>
  ? Exclude<Requirements, Incoming>
  : never;

type ProvidedByAll<Ops extends ReadonlyArray<RuntimeOperator>> = Ops extends
  readonly [infer Head, ...infer Tail] ?
    | ProvidedBy<Head>
    | ProvidedByAll<Extract<Tail, ReadonlyArray<RuntimeOperator>>>
  : never;

type ApplyOperator<Seed, Op> = Op extends (self: Seed) => infer Out ? Out
  : never;

type ApplyOperators<
  Seed,
  Ops extends ReadonlyArray<RuntimeOperator>,
> = Ops extends readonly [infer Head, ...infer Tail] ? ApplyOperators<
    ApplyOperator<Seed, Head>,
    Extract<Tail, ReadonlyArray<RuntimeOperator>>
  >
  : Seed;

type FinalRuntimeLayer<Ops extends ReadonlyArray<RuntimeOperator>> =
  ApplyOperators<RuntimeSeedLayer<ProvidedByAll<Ops>>, Ops> extends infer Out
    ? Out extends Layer.Layer<unknown, unknown, infer Incoming>
      ? [Incoming] extends [never] ? Out
      : never
    : never
    : never;

type OptionalArgument<Input> = undefined extends Input ? Input | void : Input;

type SchemaInput<SchemaType extends EffectSchema> = Schema.Schema.Encoded<
  SchemaType
>;
type SchemaOutput<SchemaType extends EffectSchema> = Schema.Schema.Type<
  SchemaType
>;

type FieldHelpers<FormShape, SchemaType> = FormShape extends
  Record<string, unknown> ? {
    [Key in keyof FormShape as Key extends string ? Key : never]: (
      message: string,
    ) => Effect.Effect<never, FormError<SchemaType>, never>;
  }
  : Record<PropertyKey, never>;

/**
 * Proxy passed into `Form` handlers for reporting validation issues. Call
 * `invalid.form(message)` for a top-level issue, or `invalid.<field>(message)`
 * to attach the issue to a specific field declared in the schema.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export type Invalid<SchemaType = unknown> =
  & {
    /** Attach a top-level form issue with the supplied message. */
    form: (
      message: string,
    ) => Effect.Effect<never, FormError<SchemaType>, never>;
  }
  & FieldHelpers<
    SchemaType extends EffectSchema ? SchemaOutput<SchemaType> : unknown,
    SchemaType
  >;

/**
 * Shape of an Effect-returning remote `query`. Callable with the validated
 * input; exposes the underlying SvelteKit function via `native`.
 *
 * @see https://ser.barekey.dev/content/remote-functions/query
 */
export type EffectQueryFunction<Input, Output, Error = never> =
  & ((
    arg: OptionalArgument<Input>,
  ) => Effect.Effect<
    Output,
    import("$internal/remote-shared.ts").RemoteFailure<Error>,
    never
  >)
  & {
    /** Underlying SvelteKit `query` function, for fallback direct usage. */
    native: RemoteQueryFunction<Input, Output>;
  };

/**
 * Shape of an Effect-returning remote `command`. Callable with the validated
 * input; exposes the underlying SvelteKit command via `native` and tracks
 * in-flight submissions through `pending`.
 *
 * @see https://ser.barekey.dev/content/remote-functions/command
 */
export type EffectCommand<Input, Output, Error = never> =
  & ((
    arg: OptionalArgument<Input>,
  ) => Effect.Effect<
    Output,
    import("$internal/remote-shared.ts").RemoteFailure<Error>,
    never
  >)
  & {
    /** Underlying SvelteKit `command` function, for fallback direct usage. */
    native: RemoteCommand<Input, Output>;
    /** Count of currently in-flight invocations of this command. */
    readonly pending: number;
  };

/**
 * Shape of an Effect-returning remote `prerender` function. Callable with the
 * validated input; exposes the underlying SvelteKit function via `native`.
 *
 * @see https://ser.barekey.dev/content/remote-functions/prerender
 */
export type EffectPrerenderFunction<Input, Output, Error = never> =
  & ((
    arg: OptionalArgument<Input>,
  ) => Effect.Effect<
    Output,
    import("$internal/remote-shared.ts").RemoteFailure<Error>,
    never
  >)
  & {
    /** Underlying SvelteKit `prerender` function, for fallback direct usage. */
    native: RemotePrerenderFunction<Input, Output>;
  };

/**
 * Shape of an Effect-returning remote `form`. Usable anywhere the native
 * SvelteKit form is; additionally exposes `submit(data)` to run the form
 * program as an Effect, and `for(...)` to clone the binding for a given
 * input.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export type EffectForm<
  Input extends RemoteFormInput | void,
  Output,
  Error = never,
> = RemoteForm<Input, Output> & {
  /** Underlying SvelteKit `form` object, for fallback direct usage. */
  native: RemoteForm<Input, Output>;
  /** Submit the form programmatically and receive the result as an Effect. */
  submit(
    data: OptionalArgument<Input>,
  ): Effect.Effect<
    Output,
    import("$internal/remote-shared.ts").RemoteFailure<Error>,
    never
  >;
  /** Clone the form binding for a specific value - mirrors `RemoteForm.for`. */
  for: RemoteForm<Input, Output>["for"] extends
    (...args: infer Args) => infer Result
    ? (...args: Args) => EffectForm<Input, Output, Error>
    : never;
};

/**
 * Type of the SvelteKit `RequestEvent` exposed through the {@link RequestEvent}
 * Effect service.
 */
export type RequestEventService = ReturnType<typeof get_native_request_event>;

/**
 * Effect `Context.Tag` for the current SvelteKit `RequestEvent`.
 *
 * Remote functions can `yield* RequestEvent` to access cookies, headers, and
 * route state for the active request.
 *
 * @see https://ser.barekey.dev/content/runtimes/server
 */
export const RequestEvent: Context.Tag<
  RequestEventService,
  RequestEventService
> = make_context_key<RequestEventService>(
  "svelte-effect-runtime/RequestEvent",
) as Context.Tag<RequestEventService, RequestEventService>;

interface ServerRuntimeSeed {
  pipe(): Layer.Layer<never>;
  pipe<const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>]>(
    ...ops: Ops
  ): FinalRuntimeLayer<Ops>;
  make(): void;
  make<const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>]>(
    ...ops: Ops
  ): void;
}

type ServerManagedRuntime = ManagedRuntime.ManagedRuntime<unknown, unknown>;

let current_server_runtime: ServerManagedRuntime | null = null;

function runtime_seed<Requirements>(): RuntimeSeedLayer<Requirements> {
  return Layer.effectContext(Effect.context<Requirements>());
}

function pipe_server_runtime(): Layer.Layer<never>;
function pipe_server_runtime<
  const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>],
>(...ops: Ops): FinalRuntimeLayer<Ops>;
function pipe_server_runtime(
  ...ops: Array<RuntimeOperator>
): Layer.Layer<never, unknown, unknown> {
  if (ops.length === 0) {
    return Layer.empty;
  }

  return ops.reduce<Layer.Layer<unknown, unknown, unknown>>(
    (layer, op) => op(layer),
    runtime_seed<unknown>(),
  ) as Layer.Layer<never, unknown, unknown>;
}

function make_server_runtime(): void;
function make_server_runtime<
  const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>],
>(...ops: Ops): void;
function make_server_runtime(
  ...ops: [] | [RuntimeOperator, ...Array<RuntimeOperator>]
): void {
  const layer = ops.length === 0 ? pipe_server_runtime() : pipe_server_runtime(
    ...(ops as [RuntimeOperator, ...Array<RuntimeOperator>]),
  );

  const previous_runtime = current_server_runtime;

  current_server_runtime = ManagedRuntime.make(
    layer as unknown as Layer.Layer<unknown, unknown, never>,
  );

  void previous_runtime?.dispose().catch(() => undefined);
}

/**
 * Server-side runtime builder used to provide long-lived Effect services to
 * remote functions.
 *
 * @see https://ser.barekey.dev/content/reference/server-runtime
 */
export const ServerRuntime: ServerRuntimeSeed = {
  pipe: pipe_server_runtime,
  make: make_server_runtime,
};

/**
 * Resolve the active server runtime, lazily creating a default empty runtime
 * when no explicit one has been registered.
 *
 * Emitted by generated server-side remote wrappers - users should never
 * import this directly.
 *
 * @internal Internal - do not use.
 * @see https://ser.barekey.dev/content/reference/server-runtime
 */
export function get_server_runtime_or_throw(): ServerManagedRuntime {
  if (current_server_runtime !== null) {
    return current_server_runtime;
  }

  // No runtime registered — lazily create a default one with an empty layer.
  // This mirrors the client runtime behavior and makes `ServerRuntime.make()`
  // in `hooks.server.ts` optional for apps that don't need to provide custom
  // dependencies. A later explicit call to `ServerRuntime.make(...)` will
  // dispose this default and replace it.
  current_server_runtime = ManagedRuntime.make(
    pipe_server_runtime() as unknown as Layer.Layer<unknown, unknown, never>,
  );

  return current_server_runtime;
}

function create_missing_remote_functions_error(error: unknown): Error {
  return new Error(
    [
      "This remote helper was evaluated before SvelteKit's remote-function runtime was available.",
      "Enable `kit.experimental.remoteFunctions = true` in `svelte.config.js`.",
      "Enable that flag and restart Vite. If it is already enabled, this is likely an internal bug.",
    ].join(" "),
    { cause: error },
  );
}

function is_missing_request_store_error(error: unknown): boolean {
  return Boolean(
    error instanceof Error &&
      error.message.includes("Could not get the request store"),
  );
}

/**
 * Remap low-level request-store crashes into a clearer setup error when remote
 * helpers are evaluated outside SvelteKit's remote-function runtime.
 *
 * @internal Internal - do not use.
 */
export function normalize_remote_helper_error(error: unknown): unknown {
  if (is_missing_request_store_error(error)) {
    return create_missing_remote_functions_error(error);
  }

  return error;
}

function remap_remote_usage_error(error: unknown): never {
  throw normalize_remote_helper_error(error);
}

function is_effect_schema(value: unknown): value is EffectSchema {
  return Schema.isSchema(value);
}

function get_effect_schema_validator(schema: EffectSchema) {
  return to_standard_schema_v1(schema) as never;
}

function get_effect_form_validator(schema: EffectSchema) {
  return to_standard_schema_v1(schema) as never;
}

function resolve_remote_args<Fn>(validate_or_fn: unknown, maybe_fn?: Fn): {
  readonly fn: Fn;
  readonly validate: EffectSchema | "unchecked" | undefined;
} {
  if (maybe_fn === undefined) {
    return {
      fn: validate_or_fn as Fn,
      validate: undefined,
    };
  }

  if (validate_or_fn === "unchecked") {
    return {
      fn: maybe_fn,
      validate: "unchecked",
    };
  }

  if (!is_effect_schema(validate_or_fn)) {
    throw new Error(
      "Invalid schema passed to a remote function. Use Effect.Schema, 'unchecked', or omit the validator entirely.",
    );
  }

  return {
    fn: maybe_fn,
    validate: validate_or_fn,
  };
}

function get_remote_failure_status(failure: unknown): number {
  if (
    failure &&
    typeof failure === "object" &&
    typeof (failure as { status?: unknown }).status === "number"
  ) {
    return (failure as { status: number }).status;
  }

  return 500;
}

function is_development_environment(): boolean {
  const vite_environment = (
    import.meta as ImportMeta & {
      env?: {
        DEV?: boolean;
      };
    }
  ).env;

  if (typeof vite_environment?.DEV === "boolean") {
    return vite_environment.DEV;
  }

  const node_process = (globalThis as typeof globalThis & {
    process?: {
      env?: {
        DEV?: string;
        NODE_ENV?: string;
        SVELTE_EFFECT_RUNTIME_DEBUG?: string;
      };
    };
  }).process;

  return (
    node_process?.env?.SVELTE_EFFECT_RUNTIME_DEBUG === "1" ||
    node_process?.env?.DEV === "1" ||
    node_process?.env?.NODE_ENV === "development"
  );
}

const ENABLE_REMOTE_SERVER_DEBUG_LOGS = is_development_environment();

function log_remote_server_step(
  step: string,
  details?: Record<string, unknown>,
): void {
  if (!ENABLE_REMOTE_SERVER_DEBUG_LOGS) {
    return;
  }

  console.log(
    "[svelte-effect-runtime][server]",
    step,
    details ? summarize_log_details(details) : {},
  );
}

/**
 * Tagged Effect failures are often `Data.TaggedError` subclasses (i.e. real
 * `Error` objects). `console.log`-ing them dumps the full JS stack — which
 * looks like a server crash, even though the failure is a modelled,
 * caller-handleable error. Render such values as their tag + enumerable data
 * instead so the dev log stays readable.
 */
function summarize_log_details(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const summarized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    summarized[key] = summarize_log_value(value);
  }

  return summarized;
}

function summarize_log_value(value: unknown): unknown {
  if (!(value instanceof Error)) {
    return value;
  }

  const tag = (value as { _tag?: unknown })._tag;

  if (typeof tag !== "string") {
    return value;
  }

  const summary: Record<string, unknown> = {
    _tag: tag,
    message: value.message,
  };

  for (const name of Object.getOwnPropertyNames(value)) {
    if (name === "stack" || name === "message" || name === "_tag") {
      continue;
    }

    summary[name] = (value as unknown as Record<string, unknown>)[name];
  }

  return summary;
}

function encode_remote_failure(failure: unknown): never {
  log_remote_server_step("encode_remote_failure:start", {
    failure,
  });
  const { state } = get_request_store();
  const encoders = Object.fromEntries(
    Object.entries(state.transport as Transport).map(([name, transporter]) => [
      name,
      transporter.encode,
    ]),
  );
  const encoded = devalue.stringify(to_transportable_data(failure), encoders);
  const status = get_remote_failure_status(failure);

  throw svelte_error(
    status,
    {
      message: "Effect remote failure",
      ...create_serialized_remote_failure_envelope(encoded),
    } as never,
  );
}

function throw_form_error(form_error: FormError): never {
  log_remote_server_step("throw_form_error", {
    issues: form_error.issues,
  });
  svelte_invalid(
    ...form_error.issues.map((issue) => ({
      message: issue.message,
      path: [...issue.path],
    })),
  );
}

async function run_remote_effect<Success, ErrorType, Requirements>(
  program: Effect.Effect<Success, ErrorType, Requirements>,
): Promise<Success> {
  const request_event = get_native_request_event();
  const runtime = get_server_runtime_or_throw();
  log_remote_server_step("run_remote_effect:start", {
    method: request_event.request.method,
    url: request_event.url.toString(),
  });
  const provided_program = Effect.provideService(
    program,
    RequestEvent,
    request_event,
  );
  const exit = await runtime.runPromiseExit(provided_program);

  if (Exit.isSuccess(exit)) {
    log_remote_server_step("run_remote_effect:success", {
      value: exit.value,
    });
    return exit.value;
  }

  const failure = get_cause_failure<ErrorType>(exit.cause);

  if (failure !== undefined) {
    log_remote_server_step("run_remote_effect:failure", {
      failure,
    });
    if (is_form_error(failure)) {
      throw_form_error(failure);
    }

    encode_remote_failure(failure);
  }

  log_remote_server_step("run_remote_effect:defect", {
    cause: exit.cause,
  });
  throw Cause.squash(exit.cause);
}

function get_schema_field_names(schema: EffectSchema): ReadonlyArray<string> {
  return get_effect_schema_field_names(schema);
}

function create_invalid_helper<SchemaType = unknown>(
  options: {
    readonly schema?: EffectSchema;
  } = {},
): Invalid<SchemaType> {
  const field_names = options.schema
    ? new Set(get_schema_field_names(options.schema))
    : null;

  const create_issue_effect = (
    message: string,
    path: ReadonlyArray<string | number>,
  ): Effect.Effect<never, FormError<SchemaType>, never> =>
    Effect.fail(create_form_error<SchemaType>({
      message,
      path,
    }));

  const invalid = new Proxy(
    {
      form(message: string) {
        return create_issue_effect(message, []);
      },
    } as Record<
      string,
      (message: string) => Effect.Effect<never, FormError<SchemaType>, never>
    >,
    {
      get(target, property) {
        if (typeof property !== "string") {
          return Reflect.get(target, property);
        }

        if (property in target) {
          return target[property];
        }

        if (field_names !== null && !field_names.has(property)) {
          throw new Error(
            `Unknown form field '${property}' in invalid helper. v1 only supports top-level fields declared in the Effect.Schema.`,
          );
        }

        return (message: string) => create_issue_effect(message, [property]);
      },
    },
  );

  return invalid as Invalid<SchemaType>;
}

function define_native_property<T extends object, Native>(
  value: T,
  native: Native,
): T {
  Object.defineProperty(value, "native", {
    value: native,
    enumerable: false,
  });

  return value;
}

/**
 * Build a devalue transport table from Effect schemas so remote payloads can
 * round-trip custom data across the client/server boundary.
 *
 * @see https://ser.barekey.dev/content/reference/transport
 */
export function create_effect_transport<
  const Schemas extends Record<string, EffectSchema>,
>(schemas: Schemas): Transport {
  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      return [name, {
        encode(value: unknown) {
          try {
            return Schema.is(schema)(value)
              ? {
                value: Schema.encodeSync(
                  schema as Schema.Schema<unknown, unknown, never>,
                )(value),
              }
              : false;
          } catch {
            return false;
          }
        },
        decode(data: { value: unknown }) {
          return Schema.decodeSync(
            schema as Schema.Schema<unknown, unknown, never>,
          )(data.value);
        },
      }];
    }),
  );
}

/**
 * Overload set for the {@link Query} factory. Supports no-arg, `"unchecked"`,
 * and Effect.Schema-validated definitions, plus `Query.batch(...)`.
 *
 * @see https://ser.barekey.dev/content/remote-functions/query
 */
export interface EffectQueryFactory {
  /** Define a void-input query. */
  <Output, ErrorType, Requirements>(
    fn: () => Effect.Effect<Output, ErrorType, Requirements>,
  ): EffectQueryFunction<void, Output, ErrorType>;
  /** Define a query that bypasses schema validation. */
  <Input, Output, ErrorType, Requirements>(
    validate: "unchecked",
    fn: (arg: Input) => Effect.Effect<Output, ErrorType, Requirements>,
  ): EffectQueryFunction<Input, Output, ErrorType>;
  /** Define a query whose input is validated by an Effect.Schema. */
  <SchemaType extends EffectSchema, Output, ErrorType, Requirements>(
    validate: SchemaType,
    fn: (
      arg: SchemaOutput<SchemaType>,
    ) => Effect.Effect<Output, ErrorType, Requirements>,
  ): EffectQueryFunction<SchemaInput<SchemaType>, Output, ErrorType>;
  /** Define a batched query - mirrors SvelteKit's `query.batch`. */
  batch: typeof query_batch_factory;
}

type RemotePrerenderInputsGenerator<Input> = (
  event: RequestEventService,
) => AsyncIterable<Input> | Iterable<Input>;

type RemotePrerenderOptions<Input> = {
  inputs?: RemotePrerenderInputsGenerator<Input>;
  dynamic?: boolean;
};

function create_native_wrapper(value: object) {
  const wrapped = new Proxy(value, {
    apply(target, thisArg, args) {
      try {
        return Reflect.apply(
          target as unknown as (...args: Array<unknown>) => unknown,
          thisArg,
          args,
        );
      } catch (error) {
        remap_remote_usage_error(error);
      }
    },
    get(target, property, _receiver) {
      if (property === "native") {
        return value;
      }

      try {
        return Reflect.get(target, property, target);
      } catch (error) {
        remap_remote_usage_error(error);
      }
    },
    has(target, property) {
      return property === "native" || Reflect.has(target, property);
    },
    getOwnPropertyDescriptor(target, property) {
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });

  return define_native_property(wrapped, value);
}

function wrap_form_remote(native: Record<string | symbol, unknown>): object {
  const wrapped: Record<string | symbol, unknown> = {};

  for (const key of Reflect.ownKeys(native)) {
    const descriptor = Object.getOwnPropertyDescriptor(native, key);
    if (!descriptor) {
      continue;
    }

    if (key === "for" && typeof descriptor.value === "function") {
      Object.defineProperty(wrapped, key, {
        configurable: descriptor.configurable ?? true,
        enumerable: descriptor.enumerable ?? false,
        writable: descriptor.writable ?? false,
        value: (id: string | number) =>
          wrap_form_remote(
            (descriptor.value as (
              id: string | number,
            ) => Record<string | symbol, unknown>).call(native, id),
          ),
      });
      continue;
    }

    Object.defineProperty(wrapped, key, descriptor);
  }

  Object.defineProperty(wrapped, "native", {
    configurable: true,
    enumerable: false,
    value: native,
    writable: false,
  });

  Object.defineProperty(wrapped, "submit", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: () =>
      Effect.fail(
        create_remote_http_error(
          new Error(
            "form.submit() can only be called on the client. " +
              "It does not run during server-side rendering.",
          ),
          { status: 500 },
        ),
      ),
  });

  return wrapped;
}

function query_batch_factory(
  validate_or_fn: unknown,
  maybe_fn?: unknown,
): unknown {
  const resolved = resolve_remote_args(
    validate_or_fn,
    maybe_fn as
      | ((args: Array<unknown>) => Effect.Effect<unknown, unknown, unknown>)
      | undefined,
  );

  if (resolved.validate === undefined) {
    throw new Error(
      "Query.batch requires either 'unchecked' or an Effect.Schema validator to match SvelteKit's native API.",
    );
  }

  const native = resolved.validate === "unchecked"
    ? native_query.batch(
      "unchecked",
      (args: Array<unknown>) =>
        run_remote_effect(resolved.fn(args)) as Promise<
          (arg: unknown, idx: number) => unknown
        >,
    )
    : native_query.batch(
      get_effect_schema_validator(resolved.validate),
      (args: Array<unknown>) =>
        run_remote_effect(resolved.fn(args)) as Promise<
          (arg: unknown, idx: number) => unknown
        >,
    );

  return create_native_wrapper(native);
}

const query_impl = (validate_or_fn: unknown, maybe_fn?: unknown): unknown => {
  const resolved = resolve_remote_args(
    validate_or_fn,
    maybe_fn as
      | ((arg: unknown) => Effect.Effect<unknown, unknown, unknown>)
      | undefined,
  );
  const native = resolved.validate === undefined
    ? native_query(() =>
      run_remote_effect(
        (resolved.fn as () => Effect.Effect<unknown, unknown, unknown>)(),
      )
    )
    : resolved.validate === "unchecked"
    ? native_query(
      "unchecked",
      (arg: unknown) =>
        run_remote_effect(
          (resolved.fn as (
            arg: unknown,
          ) => Effect.Effect<unknown, unknown, unknown>)(arg),
        ),
    )
    : native_query(
      get_effect_schema_validator(resolved.validate),
      (arg: unknown) =>
        run_remote_effect(
          (resolved.fn as (
            arg: unknown,
          ) => Effect.Effect<unknown, unknown, unknown>)(arg),
        ),
    );

  return create_native_wrapper(native);
};

/**
 * Define a read-only remote function that returns an `Effect` on the client.
 *
 * @see https://ser.barekey.dev/content/remote-functions/query
 */
export const Query = Object.assign(query_impl, {
  batch: query_batch_factory,
}) as unknown as EffectQueryFactory;

const command_impl = (validate_or_fn: unknown, maybe_fn?: unknown): unknown => {
  const resolved = resolve_remote_args(
    validate_or_fn,
    maybe_fn as
      | ((arg: unknown) => Effect.Effect<unknown, unknown, unknown>)
      | undefined,
  );
  const native = resolved.validate === undefined
    ? native_command(() =>
      run_remote_effect(
        (resolved.fn as () => Effect.Effect<unknown, unknown, unknown>)(),
      )
    )
    : resolved.validate === "unchecked"
    ? native_command(
      "unchecked",
      (arg: unknown) =>
        run_remote_effect(
          (resolved.fn as (
            arg: unknown,
          ) => Effect.Effect<unknown, unknown, unknown>)(arg),
        ),
    )
    : native_command(
      get_effect_schema_validator(resolved.validate),
      (arg: unknown) =>
        run_remote_effect(
          (resolved.fn as (
            arg: unknown,
          ) => Effect.Effect<unknown, unknown, unknown>)(arg),
        ),
    );

  return create_native_wrapper(native);
};

/**
 * Overload set for the {@link Command} factory. Supports no-arg,
 * `"unchecked"`, and Effect.Schema-validated definitions.
 *
 * @see https://ser.barekey.dev/content/remote-functions/command
 */
export interface EffectCommandFactory {
  /** Define a void-input command. */
  <Output, ErrorType, Requirements>(
    fn: () => Effect.Effect<Output, ErrorType, Requirements>,
  ): EffectCommand<void, Output, ErrorType>;
  /** Define a command that bypasses schema validation. */
  <Input, Output, ErrorType, Requirements>(
    validate: "unchecked",
    fn: (arg: Input) => Effect.Effect<Output, ErrorType, Requirements>,
  ): EffectCommand<Input, Output, ErrorType>;
  /** Define a command whose input is validated by an Effect.Schema. */
  <SchemaType extends EffectSchema, Output, ErrorType, Requirements>(
    validate: SchemaType,
    fn: (
      arg: SchemaOutput<SchemaType>,
    ) => Effect.Effect<Output, ErrorType, Requirements>,
  ): EffectCommand<SchemaInput<SchemaType>, Output, ErrorType>;
}

/**
 * Define a write-oriented remote function that returns an `Effect` on the
 * client.
 *
 * @see https://ser.barekey.dev/content/remote-functions/command
 */
export const Command = command_impl as unknown as EffectCommandFactory;

const form_impl = (validate_or_fn: unknown, maybe_fn?: unknown): unknown => {
  const resolved = resolve_remote_args(
    validate_or_fn,
    maybe_fn as
      | ((args: unknown) => Effect.Effect<unknown, unknown, unknown>)
      | undefined,
  );
  const native = resolved.validate === undefined
    ? native_form(() =>
      run_remote_effect(
        (resolved.fn as () => Effect.Effect<unknown, unknown, unknown>)(),
      )
    )
    : resolved.validate === "unchecked"
    ? native_form(
      "unchecked",
      (data: RemoteFormInput) =>
        run_remote_effect(
          (resolved.fn as (
            args: unknown,
          ) => Effect.Effect<unknown, unknown, unknown>)({
            data,
            invalid: create_invalid_helper(),
          }),
        ),
    )
    : native_form(
      get_effect_form_validator(resolved.validate as EffectSchema),
      (data: Record<string, unknown>) =>
        run_remote_effect(
          (resolved.fn as (
            args: unknown,
          ) => Effect.Effect<unknown, unknown, unknown>)({
            data,
            invalid: create_invalid_helper({
              schema: resolved.validate as EffectSchema,
            }),
          }),
        ),
    );

  return wrap_form_remote(native as unknown as Record<string | symbol, unknown>);
};

/**
 * Overload set for the {@link Form} factory. Supports no-arg, `"unchecked"`,
 * and Effect.Schema-validated form handlers.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export interface EffectFormFactory {
  /** Define a form handler with no input data. */
  <Output, ErrorType, Requirements>(
    fn: () => Effect.Effect<Output, ErrorType, Requirements>,
  ): EffectForm<void, Output, ErrorType>;
  /** Define a form handler that bypasses schema validation. */
  <Input extends RemoteFormInput, Output, ErrorType, Requirements>(
    validate: "unchecked",
    fn: (
      args: {
        data: Input;
        invalid: Invalid;
      },
    ) => Effect.Effect<Output, ErrorType | FormError, Requirements>,
  ): EffectForm<Input, Output, ErrorType>;
  /** Define a form handler whose submitted data is validated by a schema. */
  <SchemaType extends EffectSchema, Output, ErrorType, Requirements>(
    validate: SchemaType,
    fn: (
      args: {
        data: SchemaOutput<SchemaType>;
        invalid: Invalid<SchemaType>;
      },
    ) => Effect.Effect<Output, ErrorType | FormError<SchemaType>, Requirements>,
  ): EffectForm<SchemaInput<SchemaType> & RemoteFormInput, Output, ErrorType>;
}

/**
 * Define a remote form handler that maps submitted data into an Effect
 * program.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export const Form = form_impl as unknown as EffectFormFactory;

/**
 * Overload set for the {@link Prerender} factory. Accepts the same three
 * validation flavours as the other factories, plus a SvelteKit `options` bag
 * with `inputs` / `dynamic` flags.
 *
 * @see https://ser.barekey.dev/content/remote-functions/prerender
 */
export interface EffectPrerenderFactory {
  /** Define a void-input prerender function. */
  <Output, ErrorType, Requirements>(
    fn: () => Effect.Effect<Output, ErrorType, Requirements>,
    options?: {
      inputs?: RemotePrerenderInputsGenerator<void>;
      dynamic?: boolean;
    },
  ): EffectPrerenderFunction<void, Output, ErrorType>;
  /** Define a prerender function that bypasses schema validation. */
  <Input, Output, ErrorType, Requirements>(
    validate: "unchecked",
    fn: (arg: Input) => Effect.Effect<Output, ErrorType, Requirements>,
    options?: {
      inputs?: RemotePrerenderInputsGenerator<Input>;
      dynamic?: boolean;
    },
  ): EffectPrerenderFunction<Input, Output, ErrorType>;
  /** Define a prerender function whose input is validated by a schema. */
  <SchemaType extends EffectSchema, Output, ErrorType, Requirements>(
    validate: SchemaType,
    fn: (
      arg: SchemaOutput<SchemaType>,
    ) => Effect.Effect<Output, ErrorType, Requirements>,
    options?: {
      inputs?: RemotePrerenderInputsGenerator<SchemaInput<SchemaType>>;
      dynamic?: boolean;
    },
  ): EffectPrerenderFunction<SchemaInput<SchemaType>, Output, ErrorType>;
}

type NativePrerender = {
  (
    fn: () => Promise<unknown>,
    options?: RemotePrerenderOptions<void>,
  ): object;
  (
    validate: "unchecked",
    fn: (arg: unknown) => Promise<unknown>,
    options?: RemotePrerenderOptions<unknown>,
  ): object;
  (
    validate: EffectSchema,
    fn: (arg: unknown) => Promise<unknown>,
    options?: RemotePrerenderOptions<unknown>,
  ): object;
};

const native_prerender_fn = native_prerender as unknown as NativePrerender;

const prerender_impl = (
  validate_or_fn: unknown,
  fn_or_options?: unknown,
  maybe_options?: unknown,
): unknown => {
  if (
    typeof validate_or_fn === "function" &&
    typeof fn_or_options !== "function"
  ) {
    const native = native_prerender_fn(
      () =>
        run_remote_effect(
          (validate_or_fn as () => Effect.Effect<unknown, unknown, unknown>)(),
        ),
      fn_or_options as RemotePrerenderOptions<void> | undefined,
    );

    return create_native_wrapper(native);
  }

  const resolved = resolve_remote_args(
    validate_or_fn,
    fn_or_options as
      | ((arg: unknown) => Effect.Effect<unknown, unknown, unknown>)
      | undefined,
  );
  const native = resolved.validate === "unchecked"
    ? native_prerender_fn(
      "unchecked",
      (arg: unknown) =>
        run_remote_effect(
          (resolved.fn as (
            arg: unknown,
          ) => Effect.Effect<unknown, unknown, unknown>)(arg),
        ),
      maybe_options as RemotePrerenderOptions<unknown> | undefined,
    )
    : native_prerender_fn(
      get_effect_schema_validator(resolved.validate as EffectSchema),
      (arg: unknown) =>
        run_remote_effect(
          (resolved.fn as (
            arg: unknown,
          ) => Effect.Effect<unknown, unknown, unknown>)(arg),
        ),
      maybe_options as RemotePrerenderOptions<unknown> | undefined,
    );

  return create_native_wrapper(native);
};

/**
 * Define a prerenderable remote function backed by an Effect program.
 *
 * @see https://ser.barekey.dev/content/remote-functions/prerender
 */
export const Prerender = prerender_impl as unknown as EffectPrerenderFactory;
