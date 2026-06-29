import type { Effect } from "effect";

/**
 * Stable operation codes used by transform-generated dispatcher events.
 *
 * @example
 * ```ts
 * const type = DispatcherCodes.MarkupPromise;
 * ```
 *
 * @since 3.3.0
 * @internal
 */
export const DispatcherCodes = {
  MarkupPromise: "MarkupPromise",
  MarkupRun: "MarkupRun",
  MarkupValue: "MarkupValue",
} as const;

/**
 * Options for markup promise behavior during server rendering.
 *
 * @example
 * ```ts
 * const options: MarkupPromiseOptions = { ssr: "pending" };
 * ```
 *
 * @since 3.3.0
 * @internal
 */
export interface MarkupPromiseOptions {
  /** Keep the SSR promise pending so Svelte renders an await block fallback. */
  ssr?: "pending";
}

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

/**
 * Generated event that reads a markup expression through the cached value
 * channel.
 *
 * @example
 * ```ts
 * const event: MarkupValueEvent<number, undefined> = {
 *   type: DispatcherCodes.MarkupValue,
 *   id: "Component.svelte:1:2",
 *   deps: [],
 *   fallback: undefined,
 *   fn: function* () {
 *     return yield* Effect.succeed(1);
 *   },
 * };
 * ```
 *
 * @since 3.3.0
 * @internal
 */
export interface MarkupValueEvent<A, F> {
  /** Dispatcher code identifying a markup value read. */
  type: typeof DispatcherCodes.MarkupValue;
  /** Stable identifier generated from the expression's source position. */
  id: string;
  /** Reactive dependency array captured from free identifiers. */
  deps: readonly unknown[];
  /** Value returned synchronously while the effect is pending. */
  fallback: F;
  /** Generator function that yields the effect to run. */
  fn: () => Effect.gen.Return<A, unknown, unknown>;
}

/**
 * Generated event that reads a markup expression through the cached promise
 * channel.
 *
 * @example
 * ```ts
 * const event: MarkupPromiseEvent<number> = {
 *   type: DispatcherCodes.MarkupPromise,
 *   id: "Component.svelte:1:2",
 *   deps: [],
 *   fn: function* () {
 *     return yield* Effect.succeed(1);
 *   },
 * };
 * ```
 *
 * @since 3.3.0
 * @internal
 */
export interface MarkupPromiseEvent<A> {
  /** Dispatcher code identifying a markup promise read. */
  type: typeof DispatcherCodes.MarkupPromise;
  /** Stable identifier generated from the expression's source position. */
  id: string;
  /** Reactive dependency array captured from free identifiers. */
  deps: readonly unknown[];
  /** Generator function that yields the effect to run. */
  fn: () => Effect.gen.Return<A, unknown, unknown>;
  /** Value resolved during SSR when a fallback is required. */
  ssr_fallback?: A;
  /** Optional SSR behavior for await blocks and similar contexts. */
  options?: MarkupPromiseOptions;
}

/**
 * Generated event that runs an event-handler Effect.
 *
 * @example
 * ```ts
 * const event: MarkupRunEvent<void> = {
 *   type: DispatcherCodes.MarkupRun,
 *   fn: function* () {
 *     yield* Effect.void;
 *   },
 * };
 * ```
 *
 * @since 3.3.0
 * @internal
 */
export interface MarkupRunEvent<A> {
  /** Dispatcher code identifying a markup event-handler run. */
  type: typeof DispatcherCodes.MarkupRun;
  /** Generator function that yields the effect to run. */
  fn: () => Effect.gen.Return<A, unknown, unknown>;
}

/**
 * Union of generated dispatcher events.
 *
 * @example
 * ```ts
 * const event: DispatcherEvent<number, undefined> = {
 *   type: DispatcherCodes.MarkupValue,
 *   id: "Component.svelte:1:2",
 *   deps: [],
 *   fallback: undefined,
 *   fn: function* () {
 *     return yield* Effect.succeed(1);
 *   },
 * };
 * ```
 *
 * @since 3.3.0
 * @internal
 */
export type DispatcherEvent<A, F = A> =
  | MarkupPromiseEvent<A>
  | MarkupRunEvent<A>
  | MarkupValueEvent<A, F>;
