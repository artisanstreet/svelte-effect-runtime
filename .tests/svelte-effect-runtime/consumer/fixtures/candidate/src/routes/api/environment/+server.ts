import type { RequestHandler } from "./$types";
import { Handler } from "svelte-effect-runtime/server";
import { SER_PRIVATE_PORT } from "$app/env/private";
import { Effect } from "effect";

export const GET = Handler<RequestHandler>(() =>
	Effect.sync(() => Response.json({ private_port: SER_PRIVATE_PORT })),
);
