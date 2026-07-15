import { get_dispatcher } from "$/generated/dispatcher.ts";
import type { Effect } from "effect";

/** Reads a transform-generated reactive value through the active dispatcher. */
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
