import type { Fiber as FiberType } from "effect/Fiber";
import { Cause, Effect, Exit, Fiber } from "effect";

export interface FiberWatchCallbacks<A> {
	on_complete?: () => void;
	on_success?: (value: A) => void;
	on_failure?: (error: unknown) => void;
	surface_failure?: boolean;
}

export const InterruptFiber = (fiber: FiberType<unknown, unknown>) =>
	Effect.gen(function* () {
		yield* Fiber.interrupt(fiber);
	});

/** Observes fiber completion and surfaces failures without taking ownership of the fiber. */
export const WatchFiberExit = <A>(
	options: { fiber: FiberType<unknown, unknown> } & FiberWatchCallbacks<A>,
) => {
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
};
