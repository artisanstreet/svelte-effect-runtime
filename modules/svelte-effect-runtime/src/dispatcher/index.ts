import { Effect, Layer, ManagedRuntime } from "effect";
import type { Fiber as FiberType } from "effect/Fiber";
import type { ManagedRuntime as ManagedRuntimeType } from "effect/ManagedRuntime";

import { interrupt_fiber, watch_fiber_exit } from "./fibers.ts";
import { hash_deps } from "./deps.ts";
import type { Dispose, PromiseOptions, ValueOptions } from "./types.ts";

export type { Dispose, PromiseOptions, ValueOptions } from "./types.ts";

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
  /** Resolved values and pending promises keyed by cache id. */
  #values = new Map<string, unknown>();
  /** Current cache key per value block id. */
  #value_ids = new Map<string, string>();
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
    const cache_key = `${options.id}::${hash_deps(options.deps)}`;
    const old_key = this.#value_ids.get(options.id);

    if (old_key !== undefined && old_key !== cache_key) {
      this.#interrupt_cached_fiber(old_key);
    }

    this.#value_ids.set(options.id, cache_key);

    if (this.#should_start_value_fiber(cache_key)) {
      this.#start_value_fiber(cache_key, options);
    }

    if (this.#values.has(cache_key)) {
      return this.#values.get(cache_key) as A;
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
      return Promise.reject(
        new Error("[DISPATCHER_DISPOSED]: Dispatcher has been disposed"),
      );
    }

    const cache_key = `promise:${options.id}::${hash_deps(options.deps)}`;
    const existing = this.#values.get(cache_key);

    if (existing instanceof Promise) {
      return existing as Promise<A>;
    }

    const program = Effect.gen(function* () {
      const result = yield* Effect.gen(options.factory);

      return result;
    });
    const promise = this.#runtime
      .runPromise(program as Effect.Effect<unknown, unknown, unknown>)
      .then((value) => {
        this.#values.delete(cache_key);

        return value;
      })
      .catch((error: unknown) => {
        this.#values.delete(cache_key);

        throw error;
      }) as Promise<A>;

    this.#values.set(cache_key, promise);

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
      return Promise.reject(
        new Error("[DISPATCHER_DISPOSED]: Dispatcher has been disposed"),
      );
    }

    return this.#runtime
      .runPromise(effect as Effect.Effect<unknown, unknown, unknown>)
      .catch((error: unknown) => {
        queueMicrotask(() => {
          throw error;
        });

        throw error;
      }) as Promise<A>;
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
    this.#values.clear();
    this.#value_ids.clear();
  }

  #interrupt_cached_fiber(cache_key: string): void {
    const old_fiber = this.#fibers.get(cache_key);

    if (!old_fiber) {
      return;
    }

    interrupt_fiber(this.#runtime, old_fiber);
    this.#fibers.delete(cache_key);
  }

  #should_start_value_fiber(cache_key: string): boolean {
    return (
      !this.#disposed &&
      !this.#fibers.has(cache_key) &&
      !this.#values.has(cache_key)
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
    watch_fiber_exit({
      runtime: this.#runtime,
      fiber,
      on_complete: () => this.#fibers.delete(cache_key),
      on_success: (value) => this.#values.set(cache_key, value),
    });
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
