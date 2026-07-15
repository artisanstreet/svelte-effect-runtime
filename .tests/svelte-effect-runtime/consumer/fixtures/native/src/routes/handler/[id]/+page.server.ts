import type { Actions, PageServerLoad } from "./$types";
import { getRequestEvent } from "$app/server";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = ({ locals, params, route }) => {
	const event = getRequestEvent();

	return {
		event_param: event.params.id ?? "missing",
		event_request_id: event.locals.request_id,
		id: params.id,
		request_id: locals.request_id,
		route_id: route.id,
	};
};

export const actions = {
	success: async ({ locals, params, request, route }) => {
		const event = getRequestEvent();
		const data = await request.formData();
		const message = String(data.get("message") ?? "missing");

		return {
			event_param: event.params.id ?? "missing",
			event_request_id: event.locals.request_id,
			message: `handled:${params.id}:${message}`,
			method: request.method,
			request_id: locals.request_id,
			route_id: route.id,
		};
	},
	failure: () => {
		const event = getRequestEvent();

		error(409, { message: `handler:${event.params.id}:conflict` });
	},
} satisfies Actions;
