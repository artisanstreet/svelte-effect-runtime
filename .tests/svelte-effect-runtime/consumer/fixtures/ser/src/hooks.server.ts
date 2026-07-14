import { Handler, ServerRuntime } from "svelte-effect-runtime/server";
import { RuntimeLabelLive } from "$lib/server-runtime";
import type { Handle } from "@sveltejs/kit";
import { Effect } from "effect";

export const init = () => {
	ServerRuntime.make(RuntimeLabelLive);
};

export const handle = Handler<Handle>(({ event, resolve }) =>
	Effect.gen(function* () {
		event.locals.request_id = event.request.headers.get("x-request-id") ?? "ssr";

		return yield* Effect.promise(() => Promise.resolve(resolve(event)));
	}),
);
