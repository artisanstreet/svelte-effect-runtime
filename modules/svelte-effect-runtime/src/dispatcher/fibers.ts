import { Cause, Effect, Exit, Fiber } from "effect";
import type { Fiber as FiberType } from "effect/Fiber";
import type { ManagedRuntime as ManagedRuntimeType } from "effect/ManagedRuntime";

/**
 * Callbacks fired when a watched dispatcher fiber completes.
 *
 * @example
 * ```ts
 * const callbacks: FiberWatchCallbacks<number> = {
 *   on_success: (value) => cache.set(key, value),
 * };
 * ```
 *
 * @since 2.0.0
 * @internal
 */
export interface FiberWatchCallbacks<A> {
  on_complete?: () => void;
  on_success?: (value: A) => void;
  on_failure?: (error: unknown) => void;
  surface_failure?: boolean;
}

/**
 * Interrupts a dispatcher fiber through its managed runtime.
 *
 * @example
 * ```ts
 * interrupt_fiber(runtime, fiber);
 * ```
 *
 * @since 2.0.0
 * @param runtime - Managed runtime that owns the fiber.
 * @param fiber - Fiber to interrupt.
 * @returns Nothing.
 * @internal
 */
export function interrupt_fiber(
  runtime: ManagedRuntimeType<unknown, unknown>,
  fiber: FiberType<unknown, unknown>,
): void {
  runtime.runFork(
    Fiber.interrupt(fiber) as Effect.Effect<unknown, unknown, unknown>,
  );
}

/**
 * Watches a dispatcher fiber, runs completion callbacks, and surfaces
 * non-interrupt failures on the microtask queue.
 *
 * @example
 * ```ts
 * watch_fiber_exit({ runtime, fiber, on_complete: cleanup });
 * ```
 *
 * @since 2.0.0
 * @param options - Runtime, fiber, and callbacks used for the watcher.
 * @returns Nothing.
 * @internal
 */
export function watch_fiber_exit<A>(
  options: {
    runtime: ManagedRuntimeType<unknown, unknown>;
    fiber: FiberType<unknown, unknown>;
  } & FiberWatchCallbacks<A>,
): void {
  const {
    runtime,
    fiber,
    on_complete,
    on_success,
    on_failure,
    surface_failure = true,
  } = options;

  runtime.runFork(
    Effect.flatMap(Fiber.await(fiber), (exit) =>
      Effect.sync(() => {
        if (Exit.isSuccess(exit)) {
          on_success?.(exit.value as A);
          on_complete?.();

          return;
        }

        if (!Cause.hasInterruptsOnly(exit.cause)) {
          const error = Cause.squash(exit.cause);

          on_failure?.(error);

          if (surface_failure) {
            queueMicrotask(() => {
              throw error;
            });
          }
        }

        on_complete?.();
      })),
  );
}
