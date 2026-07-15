import { GetLifecycleEvents, ResetLifecycleEvents } from "$lib/lifecycle";
import { Handler } from "svelte-effect-runtime/server";
import { Effect } from "effect";
import type { RequestHandler } from "./$types";

export const GET = Handler<RequestHandler>(function* () {
	const events = yield* GetLifecycleEvents;

	return yield* Effect.succeed(Response.json(events));
});

export const DELETE = Handler<RequestHandler>(function* () {
	yield* ResetLifecycleEvents;

	return yield* Effect.succeed(new Response(undefined, { status: 204 }));
});
