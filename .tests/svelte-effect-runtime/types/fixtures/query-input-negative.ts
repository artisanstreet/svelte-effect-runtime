import { Query } from "svelte-effect-runtime/server";
import { Effect, Schema } from "effect";

const GetUser = Query(Schema.String, (id) => Effect.succeed({ id }));

export const invalid_call = GetUser();
