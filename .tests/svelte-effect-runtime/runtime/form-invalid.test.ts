import {
	make_test_request_event,
	reset_test_request_event,
	set_test_request_event,
} from "../unit/fixtures/app-server.ts";
import { make_invalid_proxy } from "../../../modules/svelte-effect-runtime/src/server/invalid.ts";
import { reset_server_runtime } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { Handler } from "../../../modules/svelte-effect-runtime/src/server.ts";
import { assert_equals } from "../unit/helpers/assert.ts";
import { afterEach, test } from "vitest";
import { Effect } from "effect";

afterEach(() => {
	reset_test_request_event();
	reset_server_runtime();
});

test("Form invalid paths preserve numeric array indices", async () => {
	const invalid = make_invalid_proxy<{
		readonly items: readonly { readonly label: string }[];
	}>();
	const handler = Handler<() => Promise<unknown>>(() =>
		Effect.flip(invalid.items[0].label("Blocked")),
	);

	set_test_request_event(make_test_request_event());

	const failure = await handler();

	assert_equals(failure, {
		_tag: "FormError",
		issues: [{ message: "Blocked", path: ["items", 0, "label"] }],
	});
});

test("Form invalid paths keep non-canonical numeric object keys as strings", async () => {
	const invalid = make_invalid_proxy<{ readonly "01": string }>();
	const handler = Handler<() => Promise<unknown>>(() => Effect.flip(invalid["01"]("Invalid")));

	set_test_request_event(make_test_request_event());

	const failure = await handler();

	assert_equals(failure, {
		_tag: "FormError",
		issues: [{ message: "Invalid", path: ["01"] }],
	});
});

test("Form invalid paths keep canonical numeric root object keys as strings", async () => {
	const invalid = make_invalid_proxy<{ readonly "123": string }>();
	const handler = Handler<() => Promise<unknown>>(() => Effect.flip(invalid["123"]("Invalid")));

	set_test_request_event(make_test_request_event());

	const failure = await handler();

	assert_equals(failure, {
		_tag: "FormError",
		issues: [{ message: "Invalid", path: ["123"] }],
	});
});
