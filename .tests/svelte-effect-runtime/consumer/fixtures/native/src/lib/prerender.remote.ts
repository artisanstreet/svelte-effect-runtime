import { prerender } from "$app/server";
import { Schema } from "effect";

export const GetSnapshot = prerender(() => "snapshot:ready", { dynamic: true });

export const GetBuildSnapshot = prerender(() =>
	process.env.PORT ? "snapshot:unexpected-runtime" : "snapshot:build",
);

export const GetDynamicSnapshot = prerender(
	Schema.toStandardSchemaV1(Schema.String),
	(input) => `${input}:${process.env.PORT ? "runtime" : "build"}`,
	{
		dynamic: true,
		inputs: () => ["static"],
	},
);
