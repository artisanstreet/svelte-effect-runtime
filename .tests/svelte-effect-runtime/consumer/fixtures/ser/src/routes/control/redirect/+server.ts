import { Handler, Redirect } from "svelte-effect-runtime/server";
import type { RequestHandler } from "./$types";
import { Effect } from "effect";

export const GET = Handler<RequestHandler>(() =>
	Effect.gen(function* () {
		return yield* Redirect(307, "/redirected");
	}),
);
