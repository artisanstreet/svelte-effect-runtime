import {
	get_live_state,
	publish_live_value,
	reset_live_state,
} from "$lib/server/live-state.server";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => {
	return Response.json(get_live_state());
};

export const DELETE: RequestHandler = () => {
	reset_live_state();

	return new Response(null, { status: 204 });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { value: number };

	publish_live_value(body.value);

	return new Response(null, { status: 204 });
};
