import type { RequestEvent, RequestHandler } from "./$types";
import { wait_for_gate } from "$lib/server/gates.server";

function observe_request(event: RequestEvent): Record<string, string> {
	return {
		client: event.request.headers.get("x-client") ?? "missing",
		parameter: event.params.client,
		request_id: event.locals.request_id,
		route: event.route.id,
		session: event.cookies.get("session") ?? "missing",
		url: event.url.pathname,
	};
}

export const GET: RequestHandler = async (event) => {
	const before = observe_request(event);

	await wait_for_gate(event.params.client);

	return Response.json({
		after: observe_request(event),
		before,
	});
};
