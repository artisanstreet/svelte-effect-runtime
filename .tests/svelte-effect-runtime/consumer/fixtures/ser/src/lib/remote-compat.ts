import { Effect } from "effect";

export function ToRemoteEffect<A>(value: PromiseLike<A>): Effect.Effect<A>;
export function ToRemoteEffect<A, E, R>(value: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
export function ToRemoteEffect(
	value: PromiseLike<unknown> | Effect.Effect<unknown, unknown, unknown>,
) {
	return Effect.isEffect(value) ? value : Effect.promise(() => Promise.resolve(value));
}
