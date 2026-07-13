import type { Fiber as FiberType } from "effect/Fiber";
import { Cause, Effect, Exit, Fiber } from "effect";

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
 * Builds the program that interrupts a dispatcher-owned fiber.
 *
 * @example
 * ```ts
 * const Interrupt = InterruptFiber(fiber);
 * ```
 *
 * @since 4.0.1
 * @param fiber - Fiber to interrupt.
 * @returns An Effect that interrupts the fiber when the Dispatcher executes it.
 * @internal
 */
export function InterruptFiber(fiber: FiberType<unknown, unknown>): Effect.Effect<void> {
	return Effect.gen(function* () {
		yield* Fiber.interrupt(fiber);
	});
}

/**
 * Builds the program that watches a dispatcher fiber, runs completion
 * callbacks, and surfaces non-interrupt failures on the microtask queue.
 *
 * @example
 * ```ts
 * const WatchExit = WatchFiberExit({ fiber, on_complete: cleanup });
 * ```
 *
 * @since 4.0.1
 * @param options - Fiber and callbacks used by the watcher program.
 * @returns An Effect that waits for the fiber and applies its callbacks.
 * @internal
 */
export function WatchFiberExit<A>(
	options: { fiber: FiberType<unknown, unknown> } & FiberWatchCallbacks<A>,
): Effect.Effect<void> {
	const { fiber, on_complete, on_success, on_failure, surface_failure = true } = options;

	return Effect.gen(function* () {
		const exit = yield* Fiber.await(fiber);

		yield* Effect.sync(() => {
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
		});
	});
}
