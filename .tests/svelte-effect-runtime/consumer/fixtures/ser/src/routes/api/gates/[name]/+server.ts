import { GetGateStatus, ReleaseGate, ResetGate } from "$lib/server/gates.server";
import { Handler } from "svelte-effect-runtime/server";
import type { RequestHandler } from "./$types";
import { Effect } from "effect";

export const GET = Handler<RequestHandler>(({ params }) =>
	Effect.gen(function* () {
		const status = yield* GetGateStatus(params.name);

		return Response.json(status);
	}),
);

export const PUT = Handler<RequestHandler>(({ params }) =>
	Effect.gen(function* () {
		yield* ResetGate(params.name);

		return new Response(null, { status: 204 });
	}),
);

export const POST = Handler<RequestHandler>(({ params }) =>
	Effect.gen(function* () {
		yield* ReleaseGate(params.name);

		return new Response(null, { status: 204 });
	}),
);
