import { Effect, Schema } from "effect";
import { Query } from "svelte-effect-runtime";
import { DemandedFailure, PostNotFound } from "$lib/errors";

interface Post {
	readonly slug: string;
	readonly title: string;
	readonly body: string;
}

const POSTS: ReadonlyArray<Post> = [
	{ slug: "alpha", title: "Alpha post", body: "First!" },
	{ slug: "beta", title: "Beta post", body: "Second!" },
	{ slug: "gamma", title: "Gamma post", body: "Third!" }
];

// No-arg query.
export const get_all_posts = Query(() => Effect.succeed(POSTS));

// Schema-validated query. Fails with a tagged `PostNotFound` when the slug
// isn't recognised — clients can recover with `Effect.catchTag("PostNotFound")`.
export const get_post = Query(Schema.String, (slug) =>
	Effect.gen(function* () {
		const post = POSTS.find((p) => p.slug === slug);
		if (!post) return yield* new PostNotFound({ slug });
		return post;
	})
);

// Unchecked query — caller-supplied input shape, no schema.
export const get_count = Query("unchecked", (_: void) =>
	Effect.succeed({ count: POSTS.length, at: Date.now() })
);

// A query that always fails — for error-handling demos.
export const failing_query = Query(Schema.String, (reason) =>
	Effect.fail(new DemandedFailure({ reason }))
);
