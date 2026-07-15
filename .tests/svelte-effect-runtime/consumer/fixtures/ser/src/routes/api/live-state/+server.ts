import { GetLiveState, PublishLiveValue, ResetLiveState } from "$lib/server/live-state.server";
import { Handler } from "svelte-effect-runtime/server";
import type { RequestHandler } from "./$types";
import { Effect } from "effect";

export const GET = Handler<RequestHandler>(() =>
	Effect.gen(function* () {
		const state = yield* GetLiveState;

		return Response.json(state);
	}),
);

export const DELETE = Handler<RequestHandler>(() =>
	Effect.gen(function* () {
		yield* ResetLiveState;

		return new Response(null, { status: 204 });
	}),
);

export const POST = Handler<RequestHandler>(({ request }) =>
	Effect.gen(function* () {
		const body = yield* Effect.promise(() => request.json() as Promise<{ value: number }>);

		yield* PublishLiveValue(body.value);

		return new Response(null, { status: 204 });
	}),
);
