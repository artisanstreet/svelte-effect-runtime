import { RecordInterruptEvent } from "$lib/server/interrupt-state.server";
import { Handler } from "svelte-effect-runtime/server";
import type { RequestHandler } from "./$types";
import { Effect } from "effect";

export const GET = Handler<RequestHandler>(() =>
	Effect.gen(function* () {
		yield* RecordInterruptEvent("started");

		return yield* Effect.never.pipe(Effect.ensuring(RecordInterruptEvent("finalized")));
	}),
);
