import { lifecycle_events, reset_lifecycle_events } from "$lib/lifecycle";
import { Handler } from "svelte-effect-runtime/server";
import { Effect } from "effect";
import type { RequestHandler } from "./$types";

export const GET = Handler<RequestHandler>(function* () {
	return yield* Effect.succeed(Response.json(lifecycle_events));
});

export const DELETE = Handler<RequestHandler>(function* () {
	reset_lifecycle_events();

	return yield* Effect.succeed(new Response(undefined, { status: 204 }));
});
