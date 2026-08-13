import type { RequestEvent } from "@sveltejs/kit";

/**
 * SvelteKit 2 declares `Handle` in `@sveltejs/kit` while SvelteKit 3 (since
 * `3.0.0-next.20`) declares it only in `@sveltejs/kit/hooks`, so the fixture
 * spells out the shape it uses to stay valid on every profile.
 */
type Handle = (input: {
	event: RequestEvent;
	resolve: (event: RequestEvent) => Promise<Response>;
}) => Promise<Response>;

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.request_id = event.request.headers.get("x-request-id") ?? "ssr";

	return resolve(event);
};
