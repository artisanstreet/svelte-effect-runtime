import { GetInterruptEvents, ResetInterruptEvents } from "$lib/server/interrupt-state.server";
import { Handler } from "svelte-effect-runtime/server";
import type { RequestHandler } from "./$types";
import { Effect } from "effect";

export const GET = Handler<RequestHandler>(() =>
	Effect.gen(function* () {
		const events = yield* GetInterruptEvents;

		return Response.json(events);
	}),
);

export const DELETE = Handler<RequestHandler>(() =>
	Effect.gen(function* () {
		yield* ResetInterruptEvents;

		return new Response(null, { status: 204 });
	}),
);
