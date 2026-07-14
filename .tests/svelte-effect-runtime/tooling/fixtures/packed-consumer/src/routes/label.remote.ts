import { Query } from "svelte-effect-runtime";
import { Effect } from "effect";

export const GetLabel = Query(
	Effect.gen(function* () {
		yield* Effect.void;

		return "packed remote";
	}),
);
