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
	const server_render = is_server_render();
	const has_fallback = arguments.length >= 4;

	if (server_render && options?.ssr === "pending") {
		return new Promise<A>(() => {});
	}

	const result = get_dispatcher().promise({ id, deps, factory });

	/** A failed server Effect renders its fallback; the client runs it again. */
	if (server_render && has_fallback) {
		return result.catch(() => ssr_fallback as A);
	}

	return result;
}

function is_server_render(): boolean {
	return typeof document === "undefined";
}
