import { get_dispatcher } from "$/dispatcher.ts";

/**
 * Runtime helper emitted by the markup preprocessor for
 * `{#await yield* expr}` blocks. Delegates to the dispatcher's
 * promise mechanism — returns a Promise that resolves when the effect
 * completes.
 *
 * @since 2.0.0
 * @param id - Stable identifier generated from the expression's source
 *   position, used for cache lookups.
 * @param deps - Array of reactive dependencies.
 * @param factory - Generator function that yields the effect to run.
 * @returns A Promise that resolves with the effect's result.
 */
export function promise(
  id: string,
  deps: readonly unknown[],
  factory: () => Generator<unknown, unknown, unknown>,
): Promise<unknown> {
  return get_dispatcher().promise({ id, deps, factory });
}
