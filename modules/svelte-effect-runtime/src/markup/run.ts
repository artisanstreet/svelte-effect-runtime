import { get_dispatcher } from "$/generated/dispatcher.ts";
import { Effect } from "effect";

/**
 * Runtime helper emitted by the markup transform for inline event
 * handlers containing `yield*`. Wraps the user's generator in an
 * `Effect.gen` and delegates execution to the dispatcher, returning its
 * completion or failure to the caller.
 *
 * @example
 * ```ts
 * await run(function* () {
 *   yield* save_changes;
 * });
 * ```
 *
 * @since 2.0.0
 * @param factory - Generator function that yields the effect to run.
 * @returns A Promise that resolves or rejects when the effect completes.
 */
export function run<A, E, R>(factory: () => Effect.gen.Return<A, E, R>): Promise<A> {
	const Program = Effect.gen(factory);

	return get_dispatcher().run(Program);
}
