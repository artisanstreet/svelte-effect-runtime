import { Prerender } from "svelte-effect-runtime";
import { Effect, Schema } from "effect";

export const GetSnapshot = Prerender(
	() =>
		Effect.gen(function* () {
			return "snapshot:ready";
		}),
	{ dynamic: true },
);

export const GetBuildSnapshot = Prerender(() =>
	Effect.gen(function* () {
		return process.env.PORT ? "snapshot:unexpected-runtime" : "snapshot:build";
	}),
);

export const GetDynamicSnapshot = Prerender(
	Schema.String,
	(input) =>
		Effect.gen(function* () {
			return `${input}:${process.env.PORT ? "runtime" : "build"}`;
		}),
	{
		dynamic: true,
		inputs: () =>
			Effect.gen(function* () {
				return ["static"];
			}),
	},
);
