import { EmptyStreamYieldError, InvalidYieldableError } from "$/errors.ts";
import { Effect, Option, Stream } from "effect";

export type Yieldable<A = unknown, E = unknown, R = unknown> =
	| Effect.Effect<A, E, R>
	| Effect.gen.Return<A, E, R>
	| Stream.Stream<A, E, R>;

export type YieldSuccess<Value> =
	Value extends Stream.Stream<infer A, unknown, unknown>
		? A
		: Value extends Effect.Effect<infer A, unknown, unknown>
			? A
			: Value extends Effect.gen.Return<infer A, unknown, unknown>
				? A
				: never;

/** Normalizes generated Effect and generator values at the transform ABI boundary. */
export function ToEffect<A, E, R>(
	value: Effect.Effect<A, E, R> | Effect.gen.Return<A, E, R>,
): Effect.Effect<A, E, R>;
export function ToEffect<A, E, R>(
	value: Stream.Stream<A, E, R>,
): Effect.Effect<A, E | EmptyStreamYieldError, R>;
export function ToEffect<A, E, R>(
	value: Yieldable<A, E, R>,
): Effect.Effect<A, E | EmptyStreamYieldError, R> {
	if (Stream.isStream(value)) {
		return Stream.runHead(value).pipe(
			Effect.flatMap((option) => {
				if (Option.isSome(option)) {
					return Effect.succeed(option.value);
				}

				return Effect.fail(new EmptyStreamYieldError());
			}),
		);
	}

	if (is_generator_result<A, E, R>(value)) {
		return Effect.gen(() => value) as Effect.Effect<A, E, R>;
	}

	if (Effect.isEffect(value)) {
		return value;
	}

	return Effect.fail(new InvalidYieldableError(value));
}

function is_generator_result<A, E, R>(value: unknown): value is Effect.gen.Return<A, E, R> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { next?: unknown }).next === "function"
	);
}
