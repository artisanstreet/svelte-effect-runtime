import { RuntimeLabel } from "$lib/server-runtime";
import { Prerender } from "svelte-effect-runtime";
import { Effect, Schema } from "effect";

export const GetSnapshot = Prerender(() => Effect.succeed("snapshot:ready"), { dynamic: true });

export const GetBuildSnapshot = Prerender(() =>
	Effect.succeed(process.env.PORT ? "snapshot:unexpected-runtime" : "snapshot:build"),
);

export const GetDynamicSnapshot = Prerender(
	Schema.String,
	(input) =>
		Effect.gen(function* () {
			const runtime = yield* RuntimeLabel;

			return `${input}:${runtime.value}:${process.env.PORT ? "runtime" : "build"}`;
		}),
	{
		dynamic: true,
		inputs: () =>
			Effect.gen(function* () {
				yield* RuntimeLabel;

				return ["static"];
			}),
	},
);
