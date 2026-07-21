import { Prerender } from "svelte-effect-runtime";
import { Effect, Schema } from "effect";

export const GetSnapshot = Prerender(
	() =>
		Effect.succeed("snapshot:ready"),
	{ dynamic: true },
);

export const GetBuildSnapshot = Prerender(() =>
	Effect.succeed(process.env.PORT ? "snapshot:unexpected-runtime" : "snapshot:build"),
);

export const GetDynamicSnapshot = Prerender(
	Schema.String,
	(input) =>
		Effect.succeed(`${input}:${process.env.PORT ? "runtime" : "build"}`),
	{
		dynamic: true,
		inputs: () =>
			Effect.succeed(["static"]),
	},
);
