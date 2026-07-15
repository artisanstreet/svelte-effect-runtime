import { prerender } from "$app/server";
import { Schema } from "effect";

export const GetSnapshot = prerender(async () => "snapshot:ready", { dynamic: true });

export const GetBuildSnapshot = prerender(async () =>
	process.env.PORT ? "snapshot:unexpected-runtime" : "snapshot:build",
);

export const GetDynamicSnapshot = prerender(
	Schema.toStandardSchemaV1(Schema.String),
	async (input) => `${input}:${process.env.PORT ? "runtime" : "build"}`,
	{
		dynamic: true,
		inputs: async () => ["static"],
	},
);
