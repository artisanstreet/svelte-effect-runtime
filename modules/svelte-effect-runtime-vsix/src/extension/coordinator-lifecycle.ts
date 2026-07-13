import { Deferred, Effect, Option, Ref, Semaphore } from "effect";

/** Blocks new coordinator work once extension shutdown begins. */
export const MakeCoordinatorShutdownGate = () =>
	Effect.gen(function* () {
		const closed = yield* Ref.make(false);
		const close_started = yield* Deferred.make<void>();
		const semaphore = yield* Semaphore.make(1);
		const Run = <A, E, R>(program: Effect.Effect<A, E, R>) =>
			semaphore.withPermits(1)(
				Effect.gen(function* () {
					const is_closed = yield* Ref.get(closed);

					if (is_closed) {
						return Option.none<A>();
					}

					const value = yield* program;

					return Option.some(value);
				}),
			);
		const Close = Effect.gen(function* () {
			yield* Ref.set(closed, true);
			yield* Deferred.succeed(close_started, undefined);
			yield* semaphore.withPermits(1)(Effect.void);
		});

		return {
			await_close: Deferred.await(close_started),
			close: Close,
			run: Run,
		};
	});
