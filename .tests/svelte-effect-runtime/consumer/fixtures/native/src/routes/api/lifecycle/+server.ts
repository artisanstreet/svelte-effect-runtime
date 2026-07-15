import { lifecycle_events, reset_lifecycle_events } from "$lib/lifecycle";

export function GET(): Response {
	return Response.json(lifecycle_events);
}

export function DELETE(): Response {
	reset_lifecycle_events();

	return new Response(undefined, { status: 204 });
}
