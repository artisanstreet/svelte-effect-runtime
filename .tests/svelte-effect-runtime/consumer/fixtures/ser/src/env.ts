import { Env } from "svelte-effect-runtime/environment";
import { Effect, Schema } from "effect";

const Port = Schema.NumberFromString.pipe(Schema.withDecodingDefault(Effect.succeed("4173")));
const PublicOrigin = Schema.URLFromString.pipe(
	Schema.withDecodingDefault(Effect.succeed("https://example.com")),
);

export const variables = Env.make({
	SER_PRIVATE_PORT: Env.private(Port, {
		description: "Private port used by the SER environment fixture.",
	}),
	SER_PUBLIC_ORIGIN: Env.public(PublicOrigin, {
		description: "Public origin used by the SER environment fixture.",
	}),
});
