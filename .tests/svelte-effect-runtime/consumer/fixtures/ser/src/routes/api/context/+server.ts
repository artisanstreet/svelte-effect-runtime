import { Handler, RequestEvent } from "svelte-effect-runtime/server";
import type { RequestHandler } from "./$types";
import { Effect } from "effect";

export const GET = Handler<RequestHandler>(() =>
	Effect.gen(function* () {
		const event = yield* RequestEvent;

		return Response.json({
			client: event.request.headers.get("x-client") ?? "missing",
			request_id: event.locals.request_id,
			route: event.route.id,
			session: event.cookies.get("session") ?? "missing",
			url: event.url.pathname,
		});
	}),
);
