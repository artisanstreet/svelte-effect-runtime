import { Effect, Schema } from "effect";
import { Form } from "svelte-effect-runtime";

const PostSchema = Schema.Struct({
	title: Schema.String,
	body: Schema.String
});

export const create_post = Form(PostSchema, ({ data, invalid }) =>
	Effect.gen(function* () {
		if (data.title.trim().length === 0) {
			return yield* invalid.title("Please enter a title.");
		}
		if (data.body.trim().length < 3) {
			return yield* invalid.body("Body must be at least 3 characters.");
		}
		return {
			slug: data.title.toLowerCase().replace(/\s+/g, "-"),
			title: data.title,
			body: data.body
		};
	})
);
