import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";
import type { Fiber as FiberType } from "effect/Fiber";
import type { ManagedRuntime as ManagedRuntimeType } from "effect/ManagedRuntime";

/**
 * Minimal clean-up handle returned by {@link Dispatcher.fork} and related
 * lifecycle hooks. Calling the handle cancels the associated fiber.
 *
 * @since 2.0.0
 * @internal
 */
export type Dispose = () => void;

/**
 * Options for {@link Dispatcher.value}.
 *
 * @since 2.0.0
 * @internal
 */
export interface ValueOptions<A> {
  /** Stable cache key for this value block. */
  id: string;
  /** Reactive dependency array. When any dep changes the previous fiber is cancelled and a new one starts. */
  deps: readonly unknown[];
  /** Value returned synchronously while the effect is running or during SSR. */
  fallback: A;
  /** Generator function that yields the effect to run. The resolved value is cached under `(id, deps)`. */
  factory: () => Effect.gen.Return<A, unknown, unknown>;
}

/**
 * Options for {@link Dispatcher.promise}.
 *
 * @since 2.0.0
 * @internal
 */
export interface PromiseOptions<A> {
  /** Stable cache key for this promise block. */
  id: string;
  /** Reactive dependency array. */
  deps: readonly unknown[];
  /** Generator function that yields the effect to run. */
  factory: () => Effect.gen.Return<A, unknown, unknown>;
}

const object_dep_ids = new WeakMap<object, number>();
const symbol_dep_ids = new Map<symbol, number>();

let next_object_dep_id = 0;
let next_symbol_dep_id = 0;

/**
 * Builds a deterministic cache key from a dependency array. Primitive values
 * are encoded as tagged JSON parts; objects and symbols receive stable ids
 * for the lifetime of the module.
 *
 * @since 2.0.0
 * @param deps - The dependency array to hash.
 * @returns A structured string key suitable for Map lookups.
 */
function hash_deps(deps: readonly unknown[]): string {
  const parts = deps.map((dep) => {
    if (dep === null) return "l:null";
    if (dep === undefined) return "u:undefined";

    const type = typeof dep;

    if (type === "string") {
      return ["s", dep];
    }

    if (type === "number") {
      return `n:${Object.is(dep, -0) ? "-0" : String(dep)}`;
    }

    if (type === "bigint") return `b:${dep}`;

    if (type === "boolean") return dep ? "t:true" : "f:false";

    if (type === "symbol") {
      let id = symbol_dep_ids.get(dep as symbol);

      if (id === undefined) {
        next_symbol_dep_id += 1;
        id = next_symbol_dep_id;
        symbol_dep_ids.set(dep as symbol, id);
      }

      return `y:${id}`;
    }

    /** Object - assign a stable numeric id for this reference. */
    let id = object_dep_ids.get(dep as object);

    if (id === undefined) {
      next_object_dep_id += 1;
      id = next_object_dep_id;
      object_dep_ids.set(dep as object, id);
    }

    return `o:${id}`;
  });

  return JSON.stringify(parts);
}

/**
 * Unified effect block dispatcher. Manages the fiber lifecycle of every
 * effect block (script, markup value, markup promise, event handler) and
 * wires results into reactive channels.
 *
 * Each dispatcher wraps a {@link ManagedRuntime} and tracks all forked
 * fibers so they can be cancelled together on component unmount.
 *
 * @example
 * ```ts
 * const dispatcher = new Dispatcher();
 *
 * const cancel = dispatcher.fork(
 *   Effect.gen(function* () {
 *     yield* Effect.log("running");
 *   })
 * );
 *
 * cancel(); // interrupts the running fiber
 * ```
 *
 * @since 2.0.0
 * @internal
 */
export class Dispatcher {
  /** The underlying Effect runtime that executes forked programs. */
  #runtime: ManagedRuntimeType<unknown, unknown>;
  /** Active fibers keyed by their cache id (for value blocks) or a generated key. */
  #fibers = new Map<string, FiberType<unknown, unknown>>();
  /** Resolved value cache, keyed by `"id::depsHash"`. */
  #values = new Map<string, unknown>();
  /** Tracks the currently-active cache key per value block id, so old fibers can be cancelled when deps change. */
  #value_ids = new Map<string, string>();
  /** Whether {@link dispose} has been called, blocking new forks. */
  #disposed = false;
  /** Monotonically increasing counter for unnamed fiber keys. */
  #next_fiber_id = 0;

  /**
   * Create a Dispatcher with an optional layer and set it as the global
   * singleton returned by {@link get_dispatcher}. Matches the
   * {@link ServerRuntime.make} convention.
   *
   * @example
   * ```ts
   * import { Dispatcher } from "svelte-effect-runtime";
   * import { Db } from "./db.ts";
   *
   * const dispatcher = Dispatcher.make(Db.Live);
   * // get_dispatcher() now returns this instance
   * ```
   *
   * @since 2.0.0
   * @param layer - Optional Effect layer to provide to the runtime.
   * @returns The newly created Dispatcher, also available via
   *   {@link get_dispatcher}.
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
   * @since 2.0.0
   * @param runtime - The ManagedRuntime to use. Defaults to a lazy-created
   *   empty-layer runtime on first fork.
   */
  constructor(runtime?: ManagedRuntimeType<unknown, unknown>) {
    this.#runtime = runtime ??
      ManagedRuntime.make(Layer.empty) as unknown as ManagedRuntimeType<
        unknown,
        unknown
      >;
  }

  /**
   * Fork an effect as a managed fiber. Returns a cleanup function that
   * interrupts the fiber when called. Non-interrupt failures are re-thrown
   * on {@link queueMicrotask} so Svelte's error boundary can catch them.
   *
   * @since 2.0.0
   * @param effect - The effect to fork.
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

    /** Watch the fiber and surface unhandled failures. */
    this.#runtime.runFork(
      Effect.flatMap(Fiber.await(fiber), (exit) =>
        Effect.sync(() => {
          this.#fibers.delete(key);

          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
            queueMicrotask(() => {
              throw Cause.squash(exit.cause);
            });
          }
        })),
    );

    let disposed = false;

    return (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      this.#runtime.runFork(
        Fiber.interrupt(fiber) as Effect.Effect<unknown, unknown, unknown>,
      );
    };
  }

  /**
   * Fork an effect and expose its result as a cached reactive value.
   * Returns the fallback synchronously; the resolved value becomes
   * available once the effect completes and subsequent calls return it
   * directly.
   *
   * When the dependency array changes (detected by a new cache key),
   * the previous fiber for that id is interrupted and a new one starts.
   *
   * @since 2.0.0
   * @param options - The id, deps, fallback, and factory.
   * @returns The cached value if resolved, or the fallback.
   */
  value<A>(options: ValueOptions<A>): A {
    const cache_key = `${options.id}::${hash_deps(options.deps)}`;

    /**
     * If the deps changed (new cache key for the same id), interrupt the
     * previous fiber so we don't waste resources on a stale computation.
     */
    const old_key = this.#value_ids.get(options.id);

    if (old_key !== undefined && old_key !== cache_key) {
      const old_fiber = this.#fibers.get(old_key);

      if (old_fiber) {
        this.#runtime.runFork(
          Fiber.interrupt(old_fiber) as Effect.Effect<
            unknown,
            unknown,
            unknown
          >,
        );
        this.#fibers.delete(old_key);
      }
    }

    this.#value_ids.set(options.id, cache_key);

    /** If a value is already cached or a fiber is already running, skip. */
    if (
      !this.#disposed &&
      !this.#fibers.has(cache_key) &&
      !this.#values.has(cache_key)
    ) {
      const program = Effect.gen(function* () {
        const result = yield* Effect.gen(options.factory);
        return result;
      });

      const fiber = this.#runtime.runFork(
        program as Effect.Effect<unknown, unknown, unknown>,
      );

      this.#fibers.set(cache_key, fiber);

      /** Watch the fiber and cache the result on success. */
      this.#runtime.runFork(
        Effect.flatMap(Fiber.await(fiber), (exit) =>
          Effect.sync(() => {
            this.#fibers.delete(cache_key);

            if (Exit.isSuccess(exit)) {
              this.#values.set(cache_key, exit.value);
            } else if (!Cause.hasInterruptsOnly(exit.cause)) {
              queueMicrotask(() => {
                throw Cause.squash(exit.cause);
              });
            }
          })),
      );
    }

    if (this.#values.has(cache_key)) {
      return this.#values.get(cache_key) as A;
    }

    return options.fallback;
  }

  /**
   * Fork an effect and expose its completion as a Promise. Intended for
   * `{#await}` blocks.
   *
   * The promise caches per `(id, deps)` — subsequent calls with the same
   * key return the same promise while the effect is running.
   *
   * @since 2.0.0
   * @param options - The id, deps, and factory.
   * @returns A Promise that resolves with the effect's result.
   */
  promise<A>(options: PromiseOptions<A>): Promise<A> {
    if (this.#disposed) {
      return Promise.reject(new Error("Dispatcher has been disposed"));
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
   * Fire-and-forget an effect (for event handlers). Returns a Promise that
   * resolves with the effect's result or rejects with its failure. Non-error
   * rejections are re-thrown on {@link queueMicrotask} so Svelte's error
   * boundary can catch them.
   *
   * @since 2.0.0
   * @param effect - The effect to run.
   * @returns A Promise that resolves or rejects when the effect completes.
   */
  run<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
    if (this.#disposed) {
      return Promise.reject(new Error("Dispatcher has been disposed"));
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
   * Cancel all running fibers and release any resources. After dispose,
   * all {@link fork}, {@link value}, {@link promise}, and {@link run} calls
   * are no-ops.
   *
   * @since 2.0.0
   */
  dispose(): void {
    this.#disposed = true;

    for (const fiber of this.#fibers.values()) {
      this.#runtime.runFork(
        Fiber.interrupt(fiber) as Effect.Effect<unknown, unknown, unknown>,
      );
    }

    this.#fibers.clear();
    this.#values.clear();
    this.#value_ids.clear();
  }
}

/** Singleton dispatcher shared across all components when no explicit runtime is configured. */
let current_dispatcher: Dispatcher | null = null;

/**
 * Resolves the active dispatcher for the current Svelte component context.
 * Emitted by the preprocessor — users should never import this directly.
 *
 * @since 2.0.0
 * @internal
 * @returns The current dispatcher, creating a default one if none exists.
 */
export function get_dispatcher(): Dispatcher {
  current_dispatcher ??= new Dispatcher();

  return current_dispatcher;
}

/**
 * Reset the global dispatcher (for testing). Disposes the current
 * dispatcher if one exists and clears the singleton reference.
 *
 * @since 2.0.0
 * @internal
 */
export function reset_dispatcher(): void {
  current_dispatcher?.dispose();
  current_dispatcher = null;
}
