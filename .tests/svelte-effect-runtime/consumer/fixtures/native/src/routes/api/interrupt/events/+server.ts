import { get_interrupt_events, reset_interrupt_events } from "$lib/server/interrupt-state.server";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => Response.json(get_interrupt_events());

export const DELETE: RequestHandler = () => {
	reset_interrupt_events();

	return new Response(null, { status: 204 });
};
