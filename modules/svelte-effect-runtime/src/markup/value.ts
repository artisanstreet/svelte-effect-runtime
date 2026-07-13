import { get_dispatcher } from "$/generated/dispatcher.ts";
import type { Effect } from "effect";

/**
 * Runtime helper emitted by the markup transform for `{yield* expr}`
 * expressions in Svelte templates. Delegates to the dispatcher's
 * cached reactive value mechanism: it returns the fallback synchronously,
 * then the resolved value once the effect completes in the browser. During
 * SSR the client dispatcher is not touched, so browser-only layers cannot
 * turn server rendering into a 500.
 *
 * @example
 * ```ts
 * const user = value(
 *   "load-user",
 *   [user_id],
 *   anonymous_user,
 *   function* () {
 *     return yield* get_user(user_id);
 *   },
 * );
 * ```
 *
 * @since 2.0.0
 * @param id - Stable identifier generated from the expression's source
 *   position, used for cache lookups.
 * @param deps - Array of reactive dependencies (free identifiers in the
 *   expression). When any dep changes, the previous fiber is cancelled
 *   and a new one starts.
 * @param fallback - Value returned while the effect is running.
 * @param factory - Generator function that yields the effect to run.
 * @returns The cached value if resolved, or the fallback.
 */
export function value<A, F, E, R>(
	id: string,
	deps: readonly unknown[],
	fallback: F,
	factory: () => Effect.gen.Return<A, E, R>,
): A | F {
	if (is_server_render()) {
		return fallback;
	}

	return get_dispatcher().value<A | F>({ id, deps, fallback, factory });
}

function is_server_render(): boolean {
	return typeof document === "undefined";
}
