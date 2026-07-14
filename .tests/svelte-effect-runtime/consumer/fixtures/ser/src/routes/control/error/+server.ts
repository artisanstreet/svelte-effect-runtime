import { Error as HttpError, Handler } from "svelte-effect-runtime/server";
import type { RequestHandler } from "./$types";
import { Effect } from "effect";

export const GET = Handler<RequestHandler>(() =>
	Effect.gen(function* () {
		return yield* HttpError(418, "teapot");
	}),
);
