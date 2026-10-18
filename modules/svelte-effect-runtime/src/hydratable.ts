import { mark_hydratable } from "$/dispatcher/hydration.ts";
import { Effect } from "effect";

/**
 * Lets a component Effect's server-rendered result hydrate on the client,
 * the Effect counterpart of Svelte's `hydratable(key, fn)`. The server runs
 * the Effect and embeds its result in the page; the hydrating client reuses
 * that result instead of running the Effect again. Values that cannot be
 * serialized, and Effects that fail on the server, run again on the client.
 *
 * It applies when it is the first Effect a component expression yields, such
 * as `{yield* Hydratable(...)}` or `$derived(yield* Hydratable(...))`. Used
 * anywhere else it simply runs the Effect.
 *
 * @example
 * ```svelte
 * <script lang="ts" effect>
 *   import { Hydratable } from "svelte-effect-runtime";
 *   import { Weather } from "$lib/weather";
 *
 *   let { city } = $props();
 *
 *   const forecast = $derived(
 *     yield* Hydratable(`forecast:${city}`, Weather.forecast(city)),
 *   );
 * </script>
 * ```
 *
 * @since 5.0.0
 * @param key - Identifies the result in the page. It must be unique per
 *   value, so include every input the Effect depends on.
 * @param effect - The Effect whose server result the client should reuse.
 * @returns An Effect that behaves like `effect`, marked for hydration.
 */
export function Hydratable<A, E, R>(
	key: string,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
	return mark_hydratable(
		Effect.suspend(() => effect),
		key,
	);
}
