import { get_dispatcher } from "$/generated/dispatcher.ts";
import { Effect } from "effect";

/** Runs a transform-generated event block through the active dispatcher. */
export function run<A, E, R>(factory: () => Effect.gen.Return<A, E, R>): Promise<A> {
	const Program = Effect.gen(factory);

	return get_dispatcher().run(Program);
}
