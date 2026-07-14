import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ cookies, locals, request, route, url }) => {
	return Response.json({
		client: request.headers.get("x-client") ?? "missing",
		request_id: locals.request_id,
		route: route.id,
		session: cookies.get("session") ?? "missing",
		url: url.pathname,
	});
};
