import { Query } from "svelte-effect-runtime/server";
import { Schema } from "effect";

export const InvalidQuery = Query(Schema.String, async (id) => id);
