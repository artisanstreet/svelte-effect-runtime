import type { Effect } from "effect";

/**
 * Minimal cleanup handle returned by dispatcher lifecycle hooks.
 *
 * @example
 * ```ts
 * const dispose: Dispose = dispatcher.fork(program);
 * dispose();
 * ```
 *
 * @since 2.0.0
 * @internal
 */
export type Dispose = () => void;

/**
 * Options for a cached dispatcher value block.
 *
 * @example
 * ```ts
 * const options: ValueOptions<number> = {
 *   id: "count",
 *   deps: [],
 *   fallback: 0,
 *   factory: () => Effect.succeed(1),
 * };
 * ```
 *
 * @since 2.0.0
 * @internal
 */
export interface ValueOptions<A> {
  /** Stable cache key for this value block. */
  id: string;
  /** Reactive dependency array. */
  deps: readonly unknown[];
  /** Value returned synchronously while the effect is running or during SSR. */
  fallback: A;
  /** Generator function that yields the effect to run. */
  factory: () => Effect.gen.Return<A, unknown, unknown>;
}

/**
 * Options for a cached dispatcher promise block.
 *
 * @example
 * ```ts
 * const options: PromiseOptions<number> = {
 *   id: "count",
 *   deps: [],
 *   factory: () => Effect.succeed(1),
 * };
 * ```
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
