import { Handler, ServerRuntime } from "svelte-effect-runtime/server";
import { RuntimeLabelLive } from "$lib/server-runtime";
import type { RequestEvent } from "@sveltejs/kit";
import { Effect } from "effect";

/**
 * SvelteKit 2 declares `Handle` in `@sveltejs/kit` while SvelteKit 3 (since
 * `3.0.0-next.20`) declares it only in `@sveltejs/kit/hooks`, so the fixture
 * spells out the shape it uses to stay valid on every profile.
 */
type Handle = (input: {
	event: RequestEvent;
	resolve: (event: RequestEvent) => Promise<Response>;
}) => Promise<Response>;

export const init = () => {
	ServerRuntime.make(RuntimeLabelLive);
};

export const handle = Handler<Handle>(({ event, resolve }) =>
	Effect.gen(function* () {
		event.locals.request_id = event.request.headers.get("x-request-id") ?? "ssr";

		return yield* Effect.promise(() => Promise.resolve(resolve(event)));
	}),
);
