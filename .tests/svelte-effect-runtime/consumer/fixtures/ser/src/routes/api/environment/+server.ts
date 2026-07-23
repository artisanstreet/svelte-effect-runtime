import type { RequestHandler } from "./$types";
import { Handler } from "svelte-effect-runtime/server";
import { SER_PRIVATE_PORT } from "$ser/env/private";

export const GET = Handler<RequestHandler>(function* () {
	const private_port = yield* SER_PRIVATE_PORT;

	return Response.json({ private_port });
});
