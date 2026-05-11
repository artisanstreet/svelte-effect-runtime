import { Effect } from "effect";
import { Form } from "svelte-effect-runtime";

// No-input form: void schema, just returns a server timestamp.
export const ping_server = Form(() =>
	Effect.succeed({
		message: "pong",
		at: new Date().toISOString()
	})
);

// Unchecked form: schema validation bypassed, raw FormData echoed.
interface EchoInput {
	[key: string]: string | string[] | File | File[];
}

export const echo_unchecked = Form("unchecked", ({ data }: { data: EchoInput; invalid: unknown }) =>
	Effect.succeed({
		keys: Object.keys(data),
		raw: JSON.parse(JSON.stringify(data))
	})
);
