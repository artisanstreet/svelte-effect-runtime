import { make_invalid_proxy } from "../../../modules/svelte-effect-runtime/src/server/invalid.ts";
import { assert_equals } from "../unit/helpers/assert.ts";
import { Effect } from "effect";
import { test } from "vitest";

test("Form invalid paths preserve numeric array indices", async () => {
	const invalid = make_invalid_proxy<{
		readonly items: readonly { readonly label: string }[];
	}>();
	const failure = await Effect.runPromise(Effect.flip(invalid.items[0].label("Blocked")));

	assert_equals(failure, {
		_tag: "FormError",
		issues: [{ message: "Blocked", path: ["items", 0, "label"] }],
	});
});

test("Form invalid paths keep non-canonical numeric object keys as strings", async () => {
	const invalid = make_invalid_proxy<{ readonly "01": string }>();
	const failure = await Effect.runPromise(Effect.flip(invalid["01"]("Invalid")));

	assert_equals(failure, {
		_tag: "FormError",
		issues: [{ message: "Invalid", path: ["01"] }],
	});
});
