import { get_gate_status, release_gate, reset_gate } from "$lib/server/gates.server";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ params }) => {
	return Response.json(get_gate_status(params.name));
};

export const PUT: RequestHandler = ({ params }) => {
	reset_gate(params.name);

	return new Response(null, { status: 204 });
};

export const POST: RequestHandler = ({ params }) => {
	release_gate(params.name);

	return new Response(null, { status: 204 });
};
