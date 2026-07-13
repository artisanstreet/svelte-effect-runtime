import { Deferred, Effect, Option, Ref, Semaphore } from "effect";

interface CoordinatorShutdownGate {
	readonly await_close: Effect.Effect<void>;
	readonly close: Effect.Effect<void>;
	readonly run: <A, E, R>(
		program: Effect.Effect<A, E, R>,
	) => Effect.Effect<Option.Option<A>, E, R>;
}

/**
 * Creates a serialized gate that drains an active coordinator transition and
 * rejects queued work once extension shutdown begins.
 *
 * @example
 * ```ts
 * const gate = yield* MakeCoordinatorShutdownGate();
 * const result = yield* gate.run(Effect.succeed("ready"));
 * yield* gate.close;
 * ```
 *
 * @since 4.0.1
 * @returns An effect that creates a shutdown gate for serialized coordinator
 *   transitions.
 */
export function MakeCoordinatorShutdownGate(): Effect.Effect<CoordinatorShutdownGate> {
	return Effect.gen(function* () {
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
}
