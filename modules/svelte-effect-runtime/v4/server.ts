/**
 * v4 server-side entrypoint for `svelte-effect-runtime`.
 *
 * Provides Effect v4-flavoured remote-function helpers and the updated
 * `ServerRuntime` builder whose `RuntimeOperator` signature accepts the
 * v4-style `Layer.provide(...)` operator. Usually consumed indirectly: the
 * Vite plugin rewrites `svelte-effect-runtime/v4` imports inside `.remote.ts`
 * to resolve here at build time.
 *
 * @example
 * ```ts
 * import { Query, ServerRuntime } from "svelte-effect-runtime/v4/_server";
 * import { Effect, Layer, Schema } from "effect";
 *
 * ServerRuntime.make(Layer.provide(MyServiceLayer));
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
import type {
  RemoteForm as SvelteKitRemoteForm,
  RemoteFormInput as SvelteKitRemoteFormInput,
} from "@sveltejs/kit";
import type { getRequestEvent as get_native_request_event } from "$app/server";
import type { Effect as Effect_type, Layer as Layer_type } from "effect";
import * as base_server from "$/v3/server.ts";
import type { FormError, RemoteFailure } from "$internal/remote-shared.ts";
import {
  type EffectContextKey,
  type EffectSchemaLike,
  make_context_key,
} from "$internal/effect-compat.ts";

/**
 * Single entry in a {@link Transport} table. Describes how to encode a value
 * to a wire payload and decode it back.
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
 * Named collection of {@link Transporter}s used by devalue to round-trip
 * custom types across the client/server boundary.
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

type OptionalArgument<Input> = undefined extends Input ? Input | void : Input;

type RuntimeOperator = (
  self: Layer_type.Layer<unknown, unknown, unknown>,
) => Layer_type.Layer<unknown, unknown, unknown>;

type RuntimeSeedLayer<Requirements> = Layer_type.Layer<
  Requirements,
  never,
  Requirements
>;

type ProvidedBy<Op> = Op extends (
  self: RuntimeSeedLayer<infer Requirements>,
) => Layer_type.Layer<unknown, unknown, infer Incoming>
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
    ? Out extends Layer_type.Layer<unknown, unknown, infer Incoming>
      ? [Incoming] extends [never] ? Out
      : never
    : never
    : never;

type SchemaInput<SchemaType extends EffectSchemaLike> = SchemaType extends
  { readonly Encoded: infer Input } ? Input
  : never;

type SchemaOutput<SchemaType extends EffectSchemaLike> = SchemaType extends
  { readonly Type: infer Output } ? Output
  : never;

type FieldHelpers<FormShape, SchemaType> = FormShape extends
  Record<string, unknown> ? {
    [Key in keyof FormShape as Key extends string ? Key : never]: (
      message: string,
    ) => Effect_type.Effect<never, FormError<SchemaType>, never>;
  }
  : Record<PropertyKey, never>;

/**
 * Proxy passed into v4 `Form` handlers for reporting validation issues. Call
 * `invalid.form(message)` for a top-level issue, or `invalid.<field>(message)`
 * to attach the issue to a specific field.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export type Invalid<SchemaType = unknown> =
  & {
    /** Attach a top-level form issue with the supplied message. */
    form: (
      message: string,
    ) => Effect_type.Effect<never, FormError<SchemaType>, never>;
  }
  & FieldHelpers<
    SchemaType extends EffectSchemaLike ? SchemaOutput<SchemaType> : unknown,
    SchemaType
  >;

/**
 * v4 shape of an Effect-returning remote `query`. Exposes the underlying
 * SvelteKit function via `native`.
 *
 * @see https://ser.barekey.dev/content/remote-functions/query
 */
export type EffectQueryFunction<Input, Output, Error = never> =
  & ((
    arg: OptionalArgument<Input>,
  ) => Effect_type.Effect<
    Output,
    RemoteFailure<Error>,
    never
  >)
  & {
    /** Underlying SvelteKit `query` function, for fallback direct usage. */
    native: RemoteQueryFunction<Input, Output>;
  };

/**
 * v4 shape of an Effect-returning remote `command`. Tracks in-flight
 * submissions via `pending`.
 *
 * @see https://ser.barekey.dev/content/remote-functions/command
 */
export type EffectCommand<Input, Output, Error = never> =
  & ((
    arg: OptionalArgument<Input>,
  ) => Effect_type.Effect<
    Output,
    RemoteFailure<Error>,
    never
  >)
  & {
    /** Underlying SvelteKit `command` function, for fallback direct usage. */
    native: RemoteCommand<Input, Output>;
    /** Count of currently in-flight invocations of this command. */
    readonly pending: number;
  };

/**
 * v4 shape of an Effect-returning remote `prerender` function.
 *
 * @see https://ser.barekey.dev/content/remote-functions/prerender
 */
export type EffectPrerenderFunction<Input, Output, Error = never> =
  & ((
    arg: OptionalArgument<Input>,
  ) => Effect_type.Effect<
    Output,
    RemoteFailure<Error>,
    never
  >)
  & {
    /** Underlying SvelteKit `prerender` function, for fallback direct usage. */
    native: RemotePrerenderFunction<Input, Output>;
  };

/**
 * v4 shape of an Effect-returning remote `form`. Effect-aware overrides for
 * the surfaces that SvelteKit exposes as Promises: `submit(data)`,
 * `enhance(callback)`, `validate(options?)`, and `for(id)`.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export type EffectForm<
  Input extends RemoteFormInput | void,
  Output,
  Error = never,
> =
  & Omit<RemoteForm<Input, Output>, "enhance" | "validate" | "for">
  & {
    /** Underlying SvelteKit `form` object, for fallback direct usage. */
    native: RemoteForm<Input, Output>;
    /** Submit the form programmatically and receive the result as an Effect. */
    submit(
      data: OptionalArgument<Input>,
    ): Effect_type.Effect<
      Output,
      RemoteFailure<Error>,
      never
    >;
    /**
     * Effect-aware version of SvelteKit's `enhance`. The callback receives
     * `submit` as a thunk returning an Effect, and may return an Effect
     * (which the runtime will run for you) or `void`.
     */
    enhance(
      callback: (args: {
        readonly form: HTMLFormElement;
        readonly data: Input;
        readonly submit: () => Effect_type.Effect<
          void,
          RemoteFailure<Error>,
          never
        >;
      }) => Effect_type.Effect<unknown, unknown, never> | void,
    ): {
      method: "POST";
      action: string;
      [attachment: symbol]: (node: HTMLFormElement) => void;
    };
    /** Effect-returning version of SvelteKit's `validate`. */
    validate(options?: {
      readonly includeUntouched?: boolean;
      readonly preflightOnly?: boolean;
    }): Effect_type.Effect<void, RemoteFailure<Error>, never>;
    /** Clone the form binding for a specific value - mirrors `RemoteForm.for`. */
    for: RemoteForm<Input, Output>["for"] extends
      (...args: infer Args) => unknown
      ? (...args: Args) => EffectForm<Input, Output, Error>
      : never;
  };

/**
 * v4 type of the SvelteKit `RequestEvent` exposed through the
 * {@link RequestEvent} Effect service.
 */
export type RequestEventService = ReturnType<typeof get_native_request_event>;

/**
 * Builder shape returned by {@link ServerRuntime} in the v4 runtime. Accepts
 * v4-style `Layer` operators and installs a singleton `ManagedRuntime`.
 *
 * @see https://ser.barekey.dev/content/reference/server-runtime
 */
export interface ServerRuntimeSeed {
  /** Compose operators into a Layer without installing a runtime. */
  pipe(): Layer_type.Layer<never>;
  /** Compose operators into a Layer without installing a runtime. */
  pipe<const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>]>(
    ...ops: Ops
  ): FinalRuntimeLayer<Ops>;
  /** Build and install the singleton server runtime. */
  make(): void;
  /** Build and install the singleton server runtime. */
  make<const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>]>(
    ...ops: Ops
  ): void;
}

/**
 * Subset of `ManagedRuntime` surface used by generated v4 server wrappers.
 *
 * @internal Internal - do not use.
 */
export interface EffectManagedRuntime {
  /** Execute an Effect and resolve with its raw `Exit`. */
  runPromiseExit<A, E, R>(
    effect: Effect_type.Effect<A, E, R>,
  ): Promise<unknown>;
  /** Tear down the runtime and release its root scope. */
  dispose(): Promise<void>;
}

/**
 * Signature of `Query.batch` in the v4 runtime - kept loosely typed because
 * the v4 server-side implementation delegates to the v3 batch factory.
 *
 * @see https://ser.barekey.dev/content/remote-functions/query
 */
export interface EffectQueryBatchFactory {
  /** Build a batched query from validator + handler arguments. */
  (...args: Array<unknown>): unknown;
}

/**
 * v4 overload set for the {@link Query} factory. Mirrors
 * {@link import("$/v3/server.ts").EffectQueryFactory} using v4 schema-like
 * inference.
 *
 * @see https://ser.barekey.dev/content/remote-functions/query
 */
export interface EffectQueryFactory {
  /** Define a void-input query. */
  <Output, Error, Requirements>(
    fn: () => Effect_type.Effect<Output, Error, Requirements>,
  ): EffectQueryFunction<void, Output, Error>;
  /** Define a query that bypasses schema validation. */
  <Input, Output, Error, Requirements>(
    validate: "unchecked",
    fn: (arg: Input) => Effect_type.Effect<Output, Error, Requirements>,
  ): EffectQueryFunction<Input, Output, Error>;
  /** Define a query whose input is validated by an Effect.Schema. */
  <SchemaType extends EffectSchemaLike, Output, Error, Requirements>(
    validate: SchemaType,
    fn: (
      arg: SchemaOutput<SchemaType>,
    ) => Effect_type.Effect<Output, Error, Requirements>,
  ): EffectQueryFunction<SchemaInput<SchemaType>, Output, Error>;
  /** Define a batched query - mirrors SvelteKit's `query.batch`. */
  batch: EffectQueryBatchFactory;
}

/**
 * v4 overload set for the {@link Command} factory.
 *
 * @see https://ser.barekey.dev/content/remote-functions/command
 */
export interface EffectCommandFactory {
  /** Define a void-input command. */
  <Output, Error, Requirements>(
    fn: () => Effect_type.Effect<Output, Error, Requirements>,
  ): EffectCommand<void, Output, Error>;
  /** Define a command that bypasses schema validation. */
  <Input, Output, Error, Requirements>(
    validate: "unchecked",
    fn: (arg: Input) => Effect_type.Effect<Output, Error, Requirements>,
  ): EffectCommand<Input, Output, Error>;
  /** Define a command whose input is validated by an Effect.Schema. */
  <SchemaType extends EffectSchemaLike, Output, Error, Requirements>(
    validate: SchemaType,
    fn: (
      arg: SchemaOutput<SchemaType>,
    ) => Effect_type.Effect<Output, Error, Requirements>,
  ): EffectCommand<SchemaInput<SchemaType>, Output, Error>;
}

type RemotePrerenderInputsGenerator<Input> = (
  event: RequestEventService,
) => AsyncIterable<Input> | Iterable<Input>;

/**
 * v4 overload set for the {@link Form} factory.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export interface EffectFormFactory {
  /** Define a form handler with no input data. */
  <Output, Error, Requirements>(
    fn: () => Effect_type.Effect<Output, Error, Requirements>,
  ): EffectForm<void, Output, Error>;
  /** Define a form handler that bypasses schema validation. */
  <Input extends RemoteFormInput, Output, Error, Requirements>(
    validate: "unchecked",
    fn: (
      args: {
        data: Input;
        invalid: Invalid;
      },
    ) => Effect_type.Effect<Output, Error | FormError, Requirements>,
  ): EffectForm<Input, Output, Error>;
  /** Define a form handler whose submitted data is validated by a schema. */
  <SchemaType extends EffectSchemaLike, Output, Error, Requirements>(
    validate: SchemaType,
    fn: (
      args: {
        data: SchemaOutput<SchemaType>;
        invalid: Invalid<SchemaType>;
      },
    ) => Effect_type.Effect<
      Output,
      Error | FormError<SchemaType>,
      Requirements
    >,
  ): EffectForm<SchemaInput<SchemaType> & RemoteFormInput, Output, Error>;
}

/**
 * v4 overload set for the {@link Prerender} factory. Supports the same three
 * validation flavours as the other factories plus a SvelteKit `options` bag
 * with `inputs` / `dynamic` flags.
 *
 * @see https://ser.barekey.dev/content/remote-functions/prerender
 */
export interface EffectPrerenderFactory {
  <Output, Error, Requirements>(
    fn: () => Effect_type.Effect<Output, Error, Requirements>,
    options?: {
      inputs?: RemotePrerenderInputsGenerator<void>;
      dynamic?: boolean;
    },
  ): EffectPrerenderFunction<void, Output, Error>;
  <Input, Output, Error, Requirements>(
    validate: "unchecked",
    fn: (arg: Input) => Effect_type.Effect<Output, Error, Requirements>,
    options?: {
      inputs?: RemotePrerenderInputsGenerator<Input>;
      dynamic?: boolean;
    },
  ): EffectPrerenderFunction<Input, Output, Error>;
  <SchemaType extends EffectSchemaLike, Output, Error, Requirements>(
    validate: SchemaType,
    fn: (
      arg: SchemaOutput<SchemaType>,
    ) => Effect_type.Effect<Output, Error, Requirements>,
    options?: {
      inputs?: RemotePrerenderInputsGenerator<SchemaInput<SchemaType>>;
      dynamic?: boolean;
    },
  ): EffectPrerenderFunction<SchemaInput<SchemaType>, Output, Error>;
}

/**
 * v4 flavour of {@link import("$/v3/server.ts").Query} - define a read-only
 * remote function returning an Effect.
 *
 * @see https://ser.barekey.dev/content/remote-functions/query
 */
export const Query: EffectQueryFactory = base_server.Query;
/**
 * v4 flavour of {@link import("$/v3/server.ts").Command} - define a
 * write-oriented remote function returning an Effect.
 *
 * @see https://ser.barekey.dev/content/remote-functions/command
 */
export const Command: EffectCommandFactory = base_server.Command;
/**
 * v4 flavour of {@link import("$/v3/server.ts").Form} - define a remote form
 * handler that maps submitted data into an Effect program.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export const Form: EffectFormFactory = base_server.Form;
/**
 * v4 flavour of {@link import("$/v3/server.ts").Prerender} - define a
 * prerenderable remote function backed by an Effect program.
 *
 * @see https://ser.barekey.dev/content/remote-functions/prerender
 */
export const Prerender: EffectPrerenderFactory = base_server.Prerender;
/**
 * v4 Effect `Context.Tag` for the current SvelteKit `RequestEvent`. Shaped
 * like an `Effect` so handlers can `yield* RequestEvent` directly.
 *
 * @see https://ser.barekey.dev/content/runtimes/server
 */
export const RequestEvent = make_context_key<
  RequestEventService,
  RequestEventService
>(
  "svelte-effect-runtime/RequestEvent",
) as
  & EffectContextKey<RequestEventService, RequestEventService>
  & Effect_type.Effect<RequestEventService, never, RequestEventService>;
/**
 * v4 server-side runtime builder. Equivalent to the v3 builder but typed
 * against the v4 `Layer` operator signature.
 *
 * @see https://ser.barekey.dev/content/reference/server-runtime
 */
export const ServerRuntime: ServerRuntimeSeed = base_server.ServerRuntime;
/**
 * Build a devalue transport table from Effect schemas so remote payloads can
 * round-trip custom data across the client/server boundary.
 *
 * @see https://ser.barekey.dev/content/reference/transport
 */
export const create_effect_transport:
  typeof base_server.create_effect_transport =
    base_server.create_effect_transport;
/**
 * Resolve the active v4 server runtime, lazily creating a default empty
 * runtime when none has been registered.
 *
 * @internal Internal - do not use.
 * @see https://ser.barekey.dev/content/reference/server-runtime
 */
export const get_server_runtime_or_throw: () => EffectManagedRuntime =
  base_server.get_server_runtime_or_throw;
/**
 * Remap low-level request-store crashes into a clearer setup error when remote
 * helpers are evaluated outside SvelteKit's remote-function runtime.
 *
 * @internal Internal - do not use.
 */
export const normalize_remote_helper_error =
  base_server.normalize_remote_helper_error;
