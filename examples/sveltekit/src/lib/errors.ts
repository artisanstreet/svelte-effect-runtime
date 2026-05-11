import { Data } from "effect";

/**
 * Tagged errors used by the example remote functions.
 *
 * `Data.TaggedError("Tag")<Fields>` produces a class with:
 *   - a `readonly _tag` discriminant matching the constructor tag,
 *   - the typed `Fields` as readonly properties,
 *   - structural equality and printable output,
 *   - JSON-/devalue-serialisability so SER can transport the failure across
 *     the wire and rehydrate it on the client with `_tag` intact.
 *
 * Pair them with `Effect.catchTag("Tag", (err) => ...)` to handle individual
 * cases, or `Effect.catchTags({ ... })` to dispatch on several at once.
 */

export class PostNotFound extends Data.TaggedError("PostNotFound")<{
	readonly slug: string;
}> {}

export class MissingTopic extends Data.TaggedError("MissingTopic")<{
	readonly slug: string;
}> {}

export class DemandedFailure extends Data.TaggedError("DemandedFailure")<{
	readonly reason: string;
}> {}

export class Boom extends Data.TaggedError("Boom")<{
	readonly message: string;
}> {}
