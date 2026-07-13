import { get_dispatcher } from "$/generated/dispatcher.ts";
import type { Effect } from "effect";

interface MarkupPromiseOptions {
	ssr?: "pending";
}

/**
 * Runtime helper emitted by the markup transform for
 * `{#await yield* expr}` blocks. Delegates to the dispatcher's
 * promise mechanism. During SSR it can return a fallback promise without
 * starting the dispatcher.
 *
 * @example
 * ```ts
 * const user = await promise(
 *   "load-user",
 *   [user_id],
 *   function* () {
 *     return yield* get_user(user_id);
 *   },
 * );
 * ```
 *
 * @since 2.0.0
 * @param id - Stable identifier generated from the expression's source
 *   position, used for cache lookups.
 * @param deps - Array of reactive dependencies.
 * @param factory - Generator function that yields the effect to run.
 * @param ssr_fallback - Value to resolve during SSR when the helper is used
 *   from an awaited expression outside a Svelte await block.
 * @param options - Optional SSR behavior for contexts such as await blocks
 *   that should render pending UI.
 * @returns A Promise that resolves with the effect's result.
 */
export function promise<A, E, R>(
	id: string,
	deps: readonly unknown[],
	factory: () => Effect.gen.Return<A, E, R>,
	ssr_fallback?: A,
	options?: MarkupPromiseOptions,
): Promise<A> {
	if (is_server_render()) {
		if (options?.ssr === "pending") {
			return new Promise<A>(() => {});
		}

		if (arguments.length >= 4) {
			return Promise.resolve(ssr_fallback as A);
		}
	}

	return get_dispatcher().promise({ id, deps, factory });
}

function is_server_render(): boolean {
	return typeof document === "undefined";
}
