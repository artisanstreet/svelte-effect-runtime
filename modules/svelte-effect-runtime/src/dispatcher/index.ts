import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";
import { SvelteMap } from "svelte/reactivity";
import type { Fiber as FiberType } from "effect/Fiber";
import type { ManagedRuntime as ManagedRuntimeType } from "effect/ManagedRuntime";

import { DispatcherDisposedError } from "$/errors.ts";
import { interrupt_fiber, watch_fiber_exit } from "./fibers.ts";
import { DispatcherCodes } from "./types.ts";
import { hash_deps } from "./deps.ts";
import type {
  DispatcherEvent,
  Dispose,
  MarkupPromiseEvent,
  MarkupRunEvent,
  MarkupValueEvent,
  PromiseOptions,
  ValueOptions,
} from "./types.ts";

export { DispatcherCodes } from "./types.ts";
export type { Dispose, PromiseOptions, ValueOptions } from "./types.ts";

type ValueCell<A> =
  | {
    readonly status: "pending";
    readonly fiber: FiberType<unknown, unknown>;
  }
  | {
    readonly status: "success";
    readonly value: A;
  }
  | {
    readonly status: "failure";
    readonly error: unknown;
  };

/**
 * Unified effect block dispatcher. Manages the fiber lifecycle of every
 * effect block and wires results into reactive channels.
 *
 * @example
 * ```ts
 * const dispatcher = new Dispatcher();
 * const cancel = dispatcher.fork(Effect.log("running"));
 * cancel();
 * ```
 *
 * @since 2.0.0
 * @internal
 */
export class Dispatcher {
  /** The underlying Effect runtime that executes forked programs. */
  #runtime: ManagedRuntimeType<unknown, unknown>;
  /** Active fibers keyed by cache id or generated fork id. */
  #fibers = new Map<string, FiberType<unknown, unknown>>();
  /** Reactive value cells keyed by value cache id. */
  #value_cells = new SvelteMap<string, ValueCell<unknown>>();
  /** Pending promises keyed by promise cache id. */
  #promise_values = new Map<string, Promise<unknown>>();
  /** Current cache key per value block id. */
  #value_ids = new Map<string, string>();
  /** Current cache key per promise block id. */
  #promise_ids = new Map<string, string>();
  /** Whether dispose has been called, blocking new work. */
  #disposed = false;
  /** Monotonically increasing counter for unnamed fiber keys. */
  #next_fiber_id = 0;

  /**
   * Creates a dispatcher with an optional layer and installs it as the global
   * singleton returned by {@link get_dispatcher}.
   *
   * @example
   * ```ts
   * const dispatcher = Dispatcher.make(Db.Live);
   * ```
   *
   * @since 2.0.0
   * @param layer - Optional Effect layer to provide to the runtime.
   * @returns The newly created dispatcher.
   */
  static make<R = never>(
    layer?: Layer.Layer<R>,
  ): Dispatcher {
    const runtime = ManagedRuntime.make(
      layer ?? (Layer.empty as unknown as Layer.Layer<R>),
    );

    const dispatcher = new Dispatcher(
      runtime as ManagedRuntimeType<unknown, unknown>,
    );
    current_dispatcher = dispatcher;

    return dispatcher;
  }

  /**
   * Creates a dispatcher backed by the provided managed runtime.
   *
   * @example
   * ```ts
   * const dispatcher = new Dispatcher(runtime);
   * ```
   *
   * @since 2.0.0
   * @param runtime - Managed runtime to use, or an empty-layer runtime when
   *   omitted.
   */
  constructor(runtime?: ManagedRuntimeType<unknown, unknown>) {
    this.#runtime = runtime ??
      ManagedRuntime.make(Layer.empty) as unknown as ManagedRuntimeType<
        unknown,
        unknown
      >;
  }

  /**
   * Handles a transform-generated dispatcher event.
   *
   * @example
   * ```ts
   * const value = dispatcher.emit({
   *   type: DispatcherCodes.MarkupValue,
   *   id: "Component.svelte:1:2",
   *   deps: [],
   *   fallback: undefined,
   *   fn: function* () {
   *     return yield* Effect.succeed(1);
   *   },
   * });
   * ```
   *
   * @since 3.3.0
   * @param event - Generated event describing the dispatcher operation to run.
   * @returns The operation result for the emitted dispatcher event.
   */
  emit<A, F>(event: MarkupValueEvent<A, F>): A | F;
  emit<A>(event: MarkupPromiseEvent<A>): Promise<A>;
  emit<A>(event: MarkupRunEvent<A>): Promise<A>;
  emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A>;
  emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A> {
    switch (event.type) {
      case DispatcherCodes.MarkupValue:
        return this.#emit_markup_value(event);

      case DispatcherCodes.MarkupPromise:
        return this.#emit_markup_promise(event);

      case DispatcherCodes.MarkupRun:
        return this.#emit_markup_run(event);
    }
  }

  /**
   * Forks an effect as a managed fiber and returns a cleanup function.
   *
   * @example
   * ```ts
   * const dispose = dispatcher.fork(Effect.log("clicked"));
   * ```
   *
   * @since 2.0.0
   * @param effect - Effect to fork.
   * @returns A function that interrupts the fiber.
   */
  fork<A, E, R>(effect: Effect.Effect<A, E, R>): Dispose {
    if (this.#disposed) {
      return () => {};
    }

    const fiber = this.#runtime.runFork(
      effect as Effect.Effect<unknown, unknown, unknown>,
    );
    const key = `fork:${this.#next_fiber_id}`;

    this.#next_fiber_id += 1;
    this.#fibers.set(key, fiber);
    watch_fiber_exit({
      runtime: this.#runtime,
      fiber,
      on_complete: () => this.#fibers.delete(key),
    });

    let disposed = false;

    return (): void => {
      if (disposed) {
        return;
      }

      disposed = true;
      interrupt_fiber(this.#runtime, fiber);
    };
  }

  /**
   * Forks an effect and exposes its result as a cached reactive value.
   *
   * @example
   * ```ts
   * const user = dispatcher.value({ id, deps, fallback, factory });
   * ```
   *
   * @since 2.0.0
   * @param options - Value id, dependency array, fallback, and effect factory.
   * @returns The cached value if resolved, otherwise the fallback.
   */
  value<A>(options: ValueOptions<A>): A {
    if (this.#disposed) {
      return options.fallback;
    }

    const cache_key = this.#make_value_cache_key(options.id, options.deps);
    const old_key = this.#value_ids.get(options.id);
    const cell = this.#value_cells.get(cache_key);

    if (old_key !== undefined && old_key !== cache_key) {
      const old_fiber = this.#interrupt_cached_fiber(old_key);

      this.#clear_pending_value_cell(old_key, old_fiber);
    }

    this.#value_ids.set(options.id, cache_key);

    if (this.#should_start_value_fiber(cache_key, cell)) {
      this.#start_value_fiber(cache_key, options);
    }

    if (cell?.status === "success") {
      return cell.value as A;
    }

    if (cell?.status === "failure") {
      throw cell.error;
    }

    return options.fallback;
  }

  /**
   * Forks an effect and exposes its completion as a cached promise.
   *
   * @example
   * ```ts
   * const promise = dispatcher.promise({ id, deps, factory });
   * ```
   *
   * @since 2.0.0
   * @param options - Promise id, dependency array, and effect factory.
   * @returns A promise that resolves with the effect result.
   */
  promise<A>(options: PromiseOptions<A>): Promise<A> {
    if (this.#disposed) {
      return Promise.reject(new DispatcherDisposedError());
    }

    const cache_key = this.#make_promise_cache_key(options.id, options.deps);
    const old_key = this.#promise_ids.get(options.id);

    if (old_key !== undefined && old_key !== cache_key) {
      this.#interrupt_cached_fiber(old_key);
      this.#promise_values.delete(old_key);
    }

    this.#promise_ids.set(options.id, cache_key);

    const existing = this.#promise_values.get(cache_key);

    if (existing) {
      return existing as Promise<A>;
    }

    const promise = this.#start_promise_fiber(cache_key, options);

    this.#promise_values.set(cache_key, promise);

    return promise;
  }

  /**
   * Runs an event-handler effect and surfaces failures to Svelte.
   *
   * @example
   * ```ts
   * await dispatcher.run(Effect.log("submit"));
   * ```
   *
   * @since 2.0.0
   * @param effect - Effect to execute.
   * @returns A promise that resolves or rejects when the effect completes.
   */
  run<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
    if (this.#disposed) {
      return Promise.reject(new DispatcherDisposedError());
    }

    const exit_effect = Effect.exit(effect) as Effect.Effect<
      unknown,
      unknown,
      unknown
    >;

    return this.#runtime
      .runPromise(exit_effect)
      .then((exit: unknown) => {
        const result = exit as Exit.Exit<A, E>;

        if (Exit.isSuccess(result)) {
          return result.value;
        }

        if (Cause.hasInterruptsOnly(result.cause)) {
          return undefined as A;
        }

        const error = Cause.squash(result.cause);

        queueMicrotask(() => {
          throw error;
        });

        throw error;
      });
  }

  #emit_markup_value<A, F>(event: MarkupValueEvent<A, F>): A | F {
    if (this.#is_server_render()) {
      return event.fallback;
    }

    return this.value<A | F>({
      id: event.id,
      deps: event.deps,
      fallback: event.fallback,
      factory: event.fn,
    });
  }

  #emit_markup_promise<A>(event: MarkupPromiseEvent<A>): Promise<A> {
    if (this.#is_server_render()) {
      if (event.options?.ssr === "pending") {
        return new Promise<A>(() => {});
      }

      if ("ssr_fallback" in event) {
        return Promise.resolve(event.ssr_fallback as A);
      }
    }

    return this.promise({
      id: event.id,
      deps: event.deps,
      factory: event.fn,
    });
  }

  #emit_markup_run<A>(event: MarkupRunEvent<A>): Promise<A> {
    const effect = Effect.gen(event.fn);

    return this.run(effect);
  }

  /**
   * Cancels all running fibers and releases cached values.
   *
   * @example
   * ```ts
   * dispatcher.dispose();
   * ```
   *
   * @since 2.0.0
   * @returns Nothing.
   */
  dispose(): void {
    this.#disposed = true;

    for (const fiber of this.#fibers.values()) {
      interrupt_fiber(this.#runtime, fiber);
    }

    this.#fibers.clear();
    this.#value_cells.clear();
    this.#promise_values.clear();
    this.#value_ids.clear();
    this.#promise_ids.clear();

    void this.#runtime.dispose().catch((error: unknown) => {
      queueMicrotask(() => {
        throw error;
      });
    });
  }

  #make_value_cache_key(id: string, deps: readonly unknown[]): string {
    return `value:${id}::${hash_deps(deps)}`;
  }

  #make_promise_cache_key(id: string, deps: readonly unknown[]): string {
    return `promise:${id}::${hash_deps(deps)}`;
  }

  #is_server_render(): boolean {
    return typeof document === "undefined";
  }

  #interrupt_cached_fiber(
    cache_key: string,
  ): FiberType<unknown, unknown> | undefined {
    const old_fiber = this.#fibers.get(cache_key);

    if (!old_fiber) {
      return undefined;
    }

    interrupt_fiber(this.#runtime, old_fiber);
    this.#fibers.delete(cache_key);

    return old_fiber;
  }

  #should_start_value_fiber(
    cache_key: string,
    cell: ValueCell<unknown> | undefined,
  ): boolean {
    return (
      !this.#disposed &&
      !this.#fibers.has(cache_key) &&
      cell === undefined
    );
  }

  #start_value_fiber<A>(cache_key: string, options: ValueOptions<A>): void {
    const program = Effect.gen(function* () {
      const result = yield* Effect.gen(options.factory);

      return result;
    });
    const fiber = this.#runtime.runFork(
      program as Effect.Effect<unknown, unknown, unknown>,
    );

    this.#fibers.set(cache_key, fiber);

    queueMicrotask(() => {
      if (!this.#is_current_fiber(cache_key, fiber)) {
        return;
      }

      if (this.#value_cells.has(cache_key)) {
        return;
      }

      this.#value_cells.set(cache_key, {
        status: "pending",
        fiber,
      });
    });

    watch_fiber_exit({
      runtime: this.#runtime,
      fiber,
      surface_failure: false,
      on_complete: () => this.#complete_fiber(cache_key, fiber),
      on_success: (value) =>
        this.#publish_value_success(
          cache_key,
          fiber,
          value,
        ),
      on_failure: (error) =>
        this.#publish_value_failure(
          cache_key,
          fiber,
          error,
        ),
    });
  }

  #start_promise_fiber<A>(
    cache_key: string,
    options: PromiseOptions<A>,
  ): Promise<A> {
    const program = Effect.gen(function* () {
      const result = yield* Effect.gen(options.factory);

      return result;
    });
    const fiber = this.#runtime.runFork(
      program as Effect.Effect<unknown, unknown, unknown>,
    );

    this.#fibers.set(cache_key, fiber);

    return this.#runtime.runPromise(
      Effect.flatMap(Fiber.await(fiber), (exit) =>
        Effect.sync(() => {
          const is_current = this.#is_current_fiber(cache_key, fiber);

          if (is_current) {
            this.#fibers.delete(cache_key);
            this.#promise_values.delete(cache_key);

            if (this.#promise_ids.get(options.id) === cache_key) {
              this.#promise_ids.delete(options.id);
            }
          }

          if (Exit.isSuccess(exit)) {
            return exit.value as A;
          }

          throw Cause.squash(exit.cause);
        })),
    );
  }

  #clear_pending_value_cell(
    cache_key: string,
    fiber: FiberType<unknown, unknown> | undefined,
  ): void {
    const cell = this.#value_cells.get(cache_key);

    if (cell?.status !== "pending") {
      return;
    }

    if (fiber !== undefined && cell.fiber !== fiber) {
      return;
    }

    this.#value_cells.delete(cache_key);
  }

  #complete_fiber(
    cache_key: string,
    fiber: FiberType<unknown, unknown>,
  ): void {
    if (!this.#is_current_fiber(cache_key, fiber)) {
      return;
    }

    this.#fibers.delete(cache_key);
  }

  #publish_value_success<A>(
    cache_key: string,
    fiber: FiberType<unknown, unknown>,
    value: A,
  ): void {
    if (!this.#is_current_fiber(cache_key, fiber)) {
      return;
    }

    this.#value_cells.set(cache_key, {
      status: "success",
      value,
    });
  }

  #publish_value_failure(
    cache_key: string,
    fiber: FiberType<unknown, unknown>,
    error: unknown,
  ): void {
    if (!this.#is_current_fiber(cache_key, fiber)) {
      return;
    }

    this.#value_cells.set(cache_key, {
      status: "failure",
      error,
    });
  }

  #is_current_fiber(
    cache_key: string,
    fiber: FiberType<unknown, unknown>,
  ): boolean {
    return !this.#disposed && this.#fibers.get(cache_key) === fiber;
  }
}

let current_dispatcher: Dispatcher | null = null;

/**
 * Resolves the active dispatcher, creating a default one if necessary.
 *
 * @example
 * ```ts
 * const dispatcher = get_dispatcher();
 * ```
 *
 * @since 2.0.0
 * @returns The active dispatcher singleton.
 * @internal
 */
export function get_dispatcher(): Dispatcher {
  current_dispatcher ??= new Dispatcher();

  return current_dispatcher;
}

/**
 * Resets the internal singleton dispatcher used by source-level tests.
 *
 * @example
 * ```ts
 * reset_dispatcher();
 * ```
 *
 * @since 2.0.0
 * @returns Nothing.
 * @internal
 */
export function reset_dispatcher(): void {
  current_dispatcher?.dispose();
  current_dispatcher = null;
}
