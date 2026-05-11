import { Effect, Schema } from "effect";
import { Command } from "svelte-effect-runtime";
import { Boom } from "$lib/errors";

// Module-scoped server state. Lives for the lifetime of the SvelteKit
// process — fine for a smoke, not realistic.
let counter = 0;

export const increment = Command(Schema.Number, (by) =>
	Effect.sync(() => {
		counter += by;
		return counter;
	})
);

export const reset_counter = Command(() =>
	Effect.sync(() => {
		counter = 0;
		return counter;
	})
);

export const echo_command = Command("unchecked", (payload: unknown) =>
	Effect.succeed({ echoed: payload, at: Date.now() })
);

// A command that fails with a tagged error — recover with
// `Effect.catchTag("Boom", ...)` on the client.
export const explode = Command(Schema.String, (message) =>
	Effect.fail(new Boom({ message }))
);
