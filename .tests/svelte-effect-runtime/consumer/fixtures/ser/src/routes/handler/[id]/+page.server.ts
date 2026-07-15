import { Error as HandlerError, Handler, RequestEvent } from "svelte-effect-runtime/server";
import type { Actions, PageServerLoad } from "./$types";
import { Effect } from "effect";

export const load = Handler<PageServerLoad>(({ locals, params, route }) =>
	Effect.gen(function* () {
		const event = yield* RequestEvent;

		return {
			event_param: event.params.id ?? "missing",
			event_request_id: event.locals.request_id,
			id: params.id,
			request_id: locals.request_id,
			route_id: route.id,
		};
	}),
);

const Success = Handler<Actions["success"]>(({ locals, params, request, route }) =>
	Effect.gen(function* () {
		const event = yield* RequestEvent;
		const data = yield* Effect.promise(() => request.formData());
		const message = String(data.get("message") ?? "missing");

		return {
			event_param: event.params.id ?? "missing",
			event_request_id: event.locals.request_id,
			message: `handled:${params.id}:${message}`,
			method: request.method,
			request_id: locals.request_id,
			route_id: route.id,
		};
	}),
);

const Failure = Handler<Actions["failure"]>(() =>
	Effect.gen(function* () {
		const event = yield* RequestEvent;

		return yield* HandlerError(409, {
			message: `handler:${event.params.id}:conflict`,
		});
	}),
);

export const actions = {
	failure: Failure,
	success: Success,
} satisfies Actions;
