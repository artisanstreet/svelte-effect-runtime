import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.request_id = event.request.headers.get("x-request-id") ?? "ssr";

	return resolve(event);
};
