import { get_dispatcher } from "$/dispatcher.ts";
import { Effect } from "effect";

/**
 * Runtime helper emitted by the markup preprocessor for inline event
 * handlers containing `yield*`. Wraps the user's generator in an
 * `Effect.gen` and delegates to the dispatcher's fire-and-forget
 * mechanism.
 *
 * @since 2.0.0
 * @param factory - Generator function that yields the effect to run.
 * @returns A Promise that resolves or rejects when the effect completes.
 */
export function run(
  factory: () => Effect.gen.Return<unknown, unknown, unknown>,
): Promise<unknown> {
  const effect = Effect.gen(factory);

  return get_dispatcher().run(effect);
}
