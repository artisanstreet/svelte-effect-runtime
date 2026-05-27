import { get_dispatcher } from "$/dispatcher.ts";
import type { Effect } from "effect";

/**
 * Runtime helper emitted by the markup preprocessor for `{yield* expr}`
 * expressions in Svelte templates. Delegates to the dispatcher's
 * cached reactive value mechanism — returns the fallback synchronously,
 * then the resolved value once the effect completes.
 *
 * @since 2.0.0
 * @param id - Stable identifier generated from the expression's source
 *   position, used for cache lookups.
 * @param deps - Array of reactive dependencies (free identifiers in the
 *   expression). When any dep changes, the previous fiber is cancelled
 *   and a new one starts.
 * @param fallback - Value returned while the effect is running or during
 *   SSR.
 * @param factory - Generator function that yields the effect to run.
 * @returns The cached value if resolved, or the fallback.
 */
export function value(
  id: string,
  deps: readonly unknown[],
  fallback: unknown,
  factory: () => Effect.gen.Return<unknown, unknown, unknown>,
): unknown {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }

  return get_dispatcher().value({ id, deps, fallback, factory });
}
