import { get_dispatcher } from "$/generated/dispatcher.ts";
import type { Effect } from "effect";

interface MarkupPromiseOptions {
	ssr?: "pending";
}

/** Runs a transform-generated promise block through the active dispatcher. */
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
