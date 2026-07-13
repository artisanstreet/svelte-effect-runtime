import { EmptyStreamYieldError } from "$/errors.ts";
import { Effect, Option, Stream } from "effect";

/**
 * Values generated `yield*` positions can normalize into an Effect.
 *
 * @example
 * ```ts
 * const value: Yieldable<number> = Stream.make(1);
 * ```
 *
 * @since 3.4.8
 */
export type Yieldable<A = unknown, E = unknown, R = unknown> =
	| Effect.Effect<A, E, R>
	| Effect.gen.Return<A, E, R>
	| Stream.Stream<A, E, R>;

/**
 * Success type produced when generated code yields an Effect or a Stream.
 *
 * @example
 * ```ts
 * type User = YieldSuccess<ReturnType<typeof loadUser>>;
 * ```
 *
 * @since 3.4.8
 */
export type YieldSuccess<Value> =
	Value extends Stream.Stream<infer A, unknown, unknown>
		? A
		: Value extends Effect.Effect<infer A, unknown, unknown>
			? A
			: Value extends Effect.gen.Return<infer A, unknown, unknown>
				? A
				: never;

/**
 * Normalizes generated `yield*` operands into Effects.
 *
 * @example
 * ```ts
 * const first = yield* ToEffect(Stream.make("ready"));
 * ```
 *
 * @since 3.4.8
 * @param value - Effect, generator return object, or Stream emitted from a
 *   lowered component `yield*` expression.
 * @returns An Effect that resolves with the original Effect success value or
 *   the first Stream emission.
 * @internal
 */
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

	return value;
}

function is_generator_result<A, E, R>(value: unknown): value is Effect.gen.Return<A, E, R> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { next?: unknown }).next === "function"
	);
}
