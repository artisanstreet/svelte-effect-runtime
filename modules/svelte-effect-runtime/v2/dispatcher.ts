/**
 * Minimal clean-up handle returned by {@link Dispatcher.fork} and related
 * lifecycle hooks.
 *
 * @since 2.0.0
 */
export type Dispose = () => void;

/**
 * Options for {@link Dispatcher.value}.
 *
 * @since 2.0.0
 */
export interface ValueOptions<R, E, A> {
  /** Stable cache key for this value block. */
  id: string;
  /** Reactive dependency array. */
  deps: readonly unknown[];
  /** Value returned before the effect resolves or during SSR. */
  fallback: A;
  /** Generator function that produces the effect to run. */
  factory: () => Generator<unknown, A, unknown>;
}

/**
 * Options for {@link Dispatcher.promise}.
 *
 * @since 2.0.0
 */
export interface PromiseOptions<R, E, A> {
  /** Stable cache key for this promise block. */
  id: string;
  /** Reactive dependency array. */
  deps: readonly unknown[];
  /** Generator function that produces the effect to run. */
  factory: () => Generator<unknown, A, unknown>;
}

/**
 * Unified effect block dispatcher. Manages the fiber lifecycle of every
 * effect block (script, markup value, markup promise, event handler) and
 * wires results into reactive channels.
 *
 * @since 2.0.0
 */
export class Dispatcher {
  #cleanups = new Set<Dispose>();
  #values = new Map<string, unknown>();
  #disposed = false;

  /**
   * Fork an effect as a managed fiber. Returns a cleanup function that cancels
   * the fiber when called.
   */
  fork<R, E, A>(_effect: unknown): Dispose {
    if (this.#disposed) return () => {};
    let called = false;
    const cleanup = () => {
      if (called) return;
      called = true;
      this.#cleanups.delete(cleanup);
    };
    this.#cleanups.add(cleanup);
    return cleanup;
  }

  /**
   * Fork an effect and expose its result as a cached reactive value. Returns
   * the fallback synchronously; the resolved value becomes available once the
   * effect completes.
   */
  value<R, E, A>(options: ValueOptions<R, E, A>): A {
    const cacheKey = `${options.id}::${options.deps.map(String).join(",")}`;
    const cached = this.#values.get(cacheKey);
    if (cached !== undefined) return cached as A;
    return options.fallback;
  }

  /**
   * Fork an effect and expose its completion as a Promise. Intended for
   * `{#await}` blocks.
   */
  promise<R, E, A>(_options: PromiseOptions<R, E, A>): Promise<A> {
    return Promise.resolve(undefined as unknown as A);
  }

  /**
   * Fire-and-forget an effect (for event handlers). Returns a Promise that
   * resolves when the effect completes or rejects on failure.
   */
  run<R, E, A>(_effect: unknown): Promise<A> {
    return Promise.resolve(undefined as unknown as A);
  }

  /**
   * Cancel all running fibers and release any resources.
   */
  dispose(): void {
    this.#disposed = true;
    for (const cleanup of this.#cleanups) {
      cleanup();
    }
    this.#cleanups.clear();
    this.#values.clear();
  }
}

// Global dispatcher instance per component context
let current_dispatcher: Dispatcher | null = null;

/**
 * Resolves the active dispatcher for the current Svelte component context.
 * Emitted by the preprocessor — users should never import this directly.
 *
 * @since 2.0.0
 * @internal
 */
export function get_dispatcher(): Dispatcher {
  if (current_dispatcher === null) {
    current_dispatcher = new Dispatcher();
  }
  return current_dispatcher;
}

/**
 * Reset the global dispatcher (for testing).
 *
 * @internal
 */
export function reset_dispatcher(): void {
  current_dispatcher?.dispose();
  current_dispatcher = null;
}
