import { Handler, RequestEvent } from "svelte-effect-runtime/server";
import { WaitForGate } from "$lib/server/gates.server";
import type { RequestHandler } from "./$types";
import { Effect } from "effect";

const ObserveRequest = Effect.gen(function* () {
	const event = yield* RequestEvent;

	return {
		client: event.request.headers.get("x-client") ?? "missing",
		parameter: event.params.client ?? "missing",
		request_id: event.locals.request_id,
		route: event.route.id,
		session: event.cookies.get("session") ?? "missing",
		url: event.url.pathname,
	};
});

export const GET = Handler<RequestHandler>(({ params }) =>
	Effect.gen(function* () {
		const before = yield* ObserveRequest;

		yield* WaitForGate(params.client);

		const after = yield* ObserveRequest;

		return Response.json({ after, before });
	}),
);
