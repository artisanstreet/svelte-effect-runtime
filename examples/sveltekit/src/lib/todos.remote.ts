import { Effect, Schema } from "effect";
import { Form } from "svelte-effect-runtime";

// `id` is `Schema.Number` (not `Schema.NumberFromString`) because the value
// is injected by `.for(todo.id)` as the raw JS number — not as a string the
// way FormData fields would be. SvelteKit's `for(id)` typing keys off the
// schema's `id` field, so passing a number here makes both type-checks and
// runtime validation line up.
const ToggleSchema = Schema.Struct({
	id: Schema.Number,
	done: Schema.optional(Schema.String)
});

export const toggle_todo = Form(ToggleSchema, ({ data }) =>
	Effect.succeed({
		id: data.id,
		done: data.done === "on"
	})
);

const DeleteSchema = Schema.Struct({
	id: Schema.Number
});

export const delete_todo = Form(DeleteSchema, ({ data }) =>
	Effect.succeed({ deleted_id: data.id, at: Date.now() })
);
