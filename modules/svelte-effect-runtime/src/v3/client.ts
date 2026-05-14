import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { getContext, hasContext, onDestroy, setContext } from "svelte";
import {
  create_remote_http_error,
  create_remote_transport_error,
  create_remote_validation_error,
  is_serialized_remote_failure_envelope,
  REMOTE_ERROR_DECODER,
  type RemoteFailure,
} from "$internal/remote-shared.ts";
import {
  create_async_effect,
  exit_has_interrupts,
} from "$internal/effect-compat.ts";

const EFFECT_RUNTIME_CONTEXT = Symbol.for("svelte-effect-runtime/runtime");
let current_client_runtime: EffectRuntime<unknown> | null = null;

interface ProvideEffectRuntimeOptions {
  disposeOnDestroy?: boolean;
}

/**
 * Minimal runtime abstraction the client adapters rely on. Implemented by the
 * Effect `ManagedRuntime` returned from {@link ClientRuntime.make}, but
 * callers may substitute their own object conforming to this shape.
 *
 * @see https://ser.barekey.dev/content/reference/client-runtime
 */
export interface EffectRuntime<R = unknown> {
  /**
   * Execute an Effect and receive a cancellation token. The optional `onExit`
   * callback fires with the final `Exit` value once the fiber completes.
   */
  runCallback<A, E, R2>(
    effect: Effect.Effect<A, E, R2>,
    options?: {
      onExit?: (exit: Exit.Exit<A, E>) => void;
    },
  ): () => void;
  /**
   * Execute an Effect and return a Promise that resolves with the success
   * value or rejects with the propagated failure.
   */
  runPromise<A, E, R2>(effect: Effect.Effect<A, E, R2>): Promise<A>;
  /**
   * Tear down the runtime and release any resources held by its root scope.
   */
  dispose(): Promise<void>;
}

export type {
  FormError,
  FormIssue,
  RemoteDomainError,
  RemoteFailure,
  RemoteHttpError,
  RemoteTransportError,
  RemoteValidationError,
} from "$internal/remote-shared.ts";

/**
 * Alias for {@link EffectRuntime} exposed as a stable service name used by
 * generated code and documentation.
 *
 * @see https://ser.barekey.dev/content/reference/client-runtime
 */
export interface ClientRuntimeService extends EffectRuntime<unknown> {}

type RuntimeSeedLayer<R> = Layer.Layer<R, never, R>;

function runtime_seed<R>(): RuntimeSeedLayer<R> {
  return Layer.effectContext(Effect.context<R>());
}

type RuntimeOperator = (
  self: Layer.Layer<unknown, unknown, unknown>,
) => Layer.Layer<unknown, unknown, unknown>;

type ProvidedBy<Op> = Op extends
  (self: RuntimeSeedLayer<infer R>) => Layer.Layer<unknown, unknown, infer RIn>
  ? Exclude<R, RIn>
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
    ? Out extends Layer.Layer<unknown, unknown, infer RIn>
      ? [RIn] extends [never] ? Out
      : never
    : never
    : never;

interface ClientRuntimeSeed {
  pipe(): Layer.Layer<never>;
  pipe<const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>]>(
    ...ops: Ops
  ): FinalRuntimeLayer<Ops>;
  make(): ManagedRuntime.ManagedRuntime<never, never>;
  make<const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>]>(
    ...ops: Ops
  ): ManagedRuntimeFromOps<Ops>;
}

type ManagedRuntimeFromOps<Ops extends ReadonlyArray<RuntimeOperator>> =
  ManagedRuntime.ManagedRuntime<
    Layer.Layer.Success<FinalRuntimeLayer<Ops>>,
    Layer.Layer.Error<FinalRuntimeLayer<Ops>>
  >;

function pipe_client_runtime(): Layer.Layer<never>;
function pipe_client_runtime<
  const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>],
>(...ops: Ops): FinalRuntimeLayer<Ops>;
function pipe_client_runtime(
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

function make_client_runtime(): ManagedRuntime.ManagedRuntime<never, never>;
function make_client_runtime<
  const Ops extends readonly [RuntimeOperator, ...Array<RuntimeOperator>],
>(...ops: Ops): ManagedRuntimeFromOps<Ops>;
function make_client_runtime(
  ...ops: [] | [RuntimeOperator, ...Array<RuntimeOperator>]
): ManagedRuntime.ManagedRuntime<never, unknown> {
  const layer = ops.length === 0 ? pipe_client_runtime() : pipe_client_runtime(
    ...(ops as [RuntimeOperator, ...Array<RuntimeOperator>]),
  );

  const runtime = track_client_runtime(ManagedRuntime.make(
    layer as unknown as Layer.Layer<unknown, unknown, never>,
  ));

  void current_client_runtime?.dispose().catch(() => undefined);
  current_client_runtime = runtime;

  if (is_component_context_available()) {
    return provide_effect_runtime(runtime, { disposeOnDestroy: true });
  }

  return runtime;
}

/**
 * Build or compose the shared client-side `ManagedRuntime` used by generated
 * `<script effect>` and markup helpers.
 *
 * @see https://ser.barekey.dev/content/reference/client-runtime
 */
export const ClientRuntime: ClientRuntimeSeed = {
  pipe: pipe_client_runtime,
  make: make_client_runtime,
};

/**
 * Register a pre-built `ManagedRuntime` on the current Svelte component
 * context. Not exported - callers should go through `ClientRuntime.make`.
 *
 * @internal Internal - do not use.
 */
function provide_effect_runtime<T extends EffectRuntime>(
  runtime: T,
  options: ProvideEffectRuntimeOptions = {},
): T {
  current_client_runtime = track_client_runtime(runtime);
  setContext(EFFECT_RUNTIME_CONTEXT, runtime);

  if (options.disposeOnDestroy) {
    onDestroy(() => {
      void runtime.dispose();
    });
  }

  return runtime;
}

/**
 * Look up the active client runtime for the current component, or lazily
 * create a default empty-layer runtime when no explicit one has been
 * registered.
 *
 * Emitted by the `<script effect>` / `{yield* ...}` preprocessor - users
 * should never import this directly.
 *
 * @internal Internal - do not use.
 * @see https://ser.barekey.dev/content/reference/client-runtime
 */
export function get_effect_runtime_or_throw<
  T extends EffectRuntime = EffectRuntime<never>,
>(): T {
  if (has_runtime_context()) {
    return getContext<T>(EFFECT_RUNTIME_CONTEXT);
  }

  if (current_client_runtime !== null) {
    return current_client_runtime as T;
  }

  // No runtime registered — lazily create a default one with an empty layer.
  // This makes `ClientRuntime.make()` in `hooks.client.ts` optional for apps
  // that don't need to provide custom dependencies. A later explicit call to
  // `ClientRuntime.make(...)` will dispose this default and replace it.
  const default_runtime = track_client_runtime(
    ManagedRuntime.make(
      Layer.empty as unknown as Layer.Layer<unknown, unknown, never>,
    ),
  );
  current_client_runtime = default_runtime;
  return default_runtime as unknown as T;
}

/**
 * Mount-time runner used by generated `<script effect>` output.
 *
 * Emitted by the preprocessor - users should never import this directly.
 *
 * @internal Internal - do not use.
 * @see https://ser.barekey.dev/content/reference/client-runtime
 */
export function run_component_effect<A, E, R>(
  runtime: EffectRuntime<R>,
  program: Effect.Effect<A, E, R>,
): () => void {
  let disposed = false;

  const cancel = runtime.runCallback(program, {
    onExit(exit) {
      if (Exit.isFailure(exit) && !exit_has_interrupts(exit)) {
        queueMicrotask(() => {
          throw Cause.squash(exit.cause);
        });
      }
    },
  });

  return () => {
    if (disposed) {
      return;
    }

    disposed = true;
    cancel();
  };
}

/**
 * Promise-returning runner used by generated `{yield* ...}` markup helpers.
 *
 * Emitted by the preprocessor - users should never import this directly.
 *
 * @internal Internal - do not use.
 * @see https://ser.barekey.dev/content/reference/client-runtime
 */
export function run_inline_effect<A, E, R>(
  runtime: EffectRuntime<R>,
  program: Effect.Effect<A, E, R>,
): Promise<A> {
  return runtime.runPromise(program).catch((error) => {
    queueMicrotask(() => {
      throw error;
    });

    throw error;
  });
}

function has_runtime_context(): boolean {
  try {
    return hasContext(EFFECT_RUNTIME_CONTEXT);
  } catch {
    return false;
  }
}

function is_component_context_available(): boolean {
  try {
    void hasContext(EFFECT_RUNTIME_CONTEXT);
    return true;
  } catch {
    return false;
  }
}

function track_client_runtime<T extends EffectRuntime>(runtime: T): T {
  const tracked_runtime = runtime as T & { __ser_tracked__?: true };

  if (tracked_runtime.__ser_tracked__ === true) {
    return tracked_runtime;
  }

  const dispose = runtime.dispose.bind(runtime);
  tracked_runtime.__ser_tracked__ = true;
  runtime.dispose = (() => {
    if (current_client_runtime === tracked_runtime) {
      current_client_runtime = null;
    }

    return dispose();
  }) as typeof runtime.dispose;

  return tracked_runtime;
}

/**
 * Internal redirect guard used by the remote client adapters.
 *
 * @internal Internal - do not use.
 */
function is_redirect_like(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { location?: unknown }).location === "string" &&
      typeof (value as { status?: unknown }).status === "number",
  );
}

type Decode_remote_payload = <ErrorType = unknown>(
  encoded: string,
) => ErrorType;

function is_http_error_like(
  value: unknown,
): value is {
  readonly body?: unknown;
  readonly status?: number;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { status?: unknown }).status === "number",
  );
}

function get_error_status(value: unknown): number {
  return is_http_error_like(value) ? value.status ?? 500 : 500;
}

function get_remote_error_decoder(
  value: unknown,
): Decode_remote_payload | undefined {
  if (
    value &&
    (typeof value === "object" || typeof value === "function") &&
    REMOTE_ERROR_DECODER in value
  ) {
    return (value as { [REMOTE_ERROR_DECODER]: Decode_remote_payload })[
      REMOTE_ERROR_DECODER
    ];
  }
}

function decode_remote_error<ErrorType>(
  error: unknown,
  decode_payload?: Decode_remote_payload,
): RemoteFailure<ErrorType> {
  if (is_http_error_like(error)) {
    const body = error.body;

    if (is_serialized_remote_failure_envelope(body) && decode_payload) {
      try {
        return decode_payload<ErrorType>(
          body.encoded,
        ) as RemoteFailure<ErrorType>;
      } catch (cause) {
        return create_remote_transport_error(cause, body);
      }
    }

    if (get_error_status(error) === 400) {
      return create_remote_validation_error([], {
        body,
        status: 400,
      });
    }

    return create_remote_http_error(error, {
      body,
      status: get_error_status(error),
    });
  }

  return create_remote_http_error(error);
}

/**
 * Internal adapter that lifts a promise-producing callback into the shared
 * remote failure channel used by client wrappers.
 *
 * @internal Internal - do not use.
 */
function create_remote_effect_from_promise<Success, ErrorType = never>(
  create_promise: () => PromiseLike<Success>,
  decode_error: (error: unknown) => RemoteFailure<ErrorType> = (error) =>
    create_remote_http_error(error),
): Effect.Effect<Success, RemoteFailure<ErrorType>, never> {
  return create_async_effect<Success, RemoteFailure<ErrorType>>((resume) => {
    void Promise.resolve()
      .then(create_promise)
      .then(
        (value) => resume(Effect.succeed(value)),
        (error) => {
          if (is_redirect_like(error)) {
            resume(Effect.die(error));
            return;
          }

          resume(Effect.fail(decode_error(error)));
        },
      );
  });
}

type AnyCallable = (...args: Array<unknown>) => unknown;

/**
 * Convert a promise or promise-returning function into an `Effect` that uses
 * the remote failure channel when applicable.
 *
 * @see https://ser.barekey.dev/content/reference/effect
 */
export function to_effect<Success, ErrorType = never>(
  promise_like: PromiseLike<Success>,
): Effect.Effect<Success, RemoteFailure<ErrorType>, never>;
export function to_effect<
  Args extends Array<unknown>,
  Success,
  ErrorType = never,
>(
  fn: (...args: Args) => PromiseLike<Success>,
): (...args: Args) => Effect.Effect<Success, RemoteFailure<ErrorType>, never>;
export function to_effect<Success, ErrorType = never>(
  value: PromiseLike<Success> | AnyCallable,
): Effect.Effect<Success, RemoteFailure<ErrorType>, never> | AnyCallable {
  const decode_payload = get_remote_error_decoder(value);

  if (typeof value === "function") {
    return ((...args: Array<unknown>) =>
      create_remote_effect_from_promise(
        () => Promise.resolve((value as AnyCallable)(...args)),
        (error) => decode_remote_error<ErrorType>(error, decode_payload),
      )) as AnyCallable;
  }

  return create_remote_effect_from_promise(
    () => value,
    (error) => decode_remote_error<ErrorType>(error, decode_payload),
  );
}

/**
 * Unwrap a runtime wrapper and recover the original native value.
 *
 * @see https://ser.barekey.dev/content/reference/effect
 */
export function to_native<Value>(
  value: Value,
): Value extends { native: infer Native } ? Native
  : Value;
export function to_native(value: unknown): unknown {
  let current = value;
  const seen = new Set<unknown>();

  while (
    current &&
    (typeof current === "object" || typeof current === "function") &&
    "native" in current
  ) {
    if (seen.has(current)) {
      break;
    }

    seen.add(current);
    current = (current as { native: unknown }).native;
  }

  return current;
}

export { create_remote_effect_from_promise, is_redirect_like };
