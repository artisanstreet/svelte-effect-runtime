import { Schema } from "effect";

export const ClientModeSchema = Schema.Literals(["auto", "direct", "svelteExtension"]);

export type ClientMode = typeof ClientModeSchema.Type;
