import { Context, Effect, Layer } from "effect";

export class Greeting extends Context.Service<Greeting, { readonly text: string }>()(
	"signals/Greeting",
) {}

export class Punctuated extends Context.Service<Punctuated, { readonly text: string }>()(
	"signals/Punctuated",
) {
	static readonly layer = Layer.effect(
		Punctuated,
		Effect.gen(function* () {
			const greeting = yield* Greeting;

			return Punctuated.of({ text: `${greeting.text}!` });
		}),
	);
}

export const MakeGreetingLayer = (record_event: (event: string) => void) =>
	Layer.effect(
		Greeting,
		Effect.acquireRelease(
			Effect.sync(() => {
				record_event("acquire");

				return Greeting.of({ text: "hello" });
			}),
			() => Effect.sync(() => record_event("release")),
		),
	);
