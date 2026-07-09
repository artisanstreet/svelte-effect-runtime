import { test } from "vitest";
import { assert_equals, assert_exists } from "./helpers/assert.ts";

test("generators exports get_dispatcher", async () => {
	const mod = await import("../../../modules/svelte-effect-runtime/src/generators.ts");
	assert_exists(mod.get_dispatcher);
	assert_equals(typeof mod.get_dispatcher, "function");
});

test("generators exports dispatcher event facade", async () => {
	const mod = await import("../../../modules/svelte-effect-runtime/src/generators.ts");

	assert_exists(mod.Dispatcher);
	assert_equals(typeof mod.Dispatcher.emit, "function");
	assert_equals(mod.Code.Markup.Promise, "MarkupPromise");
});

test("generators does NOT export Effect", async () => {
	const mod = await import("../../../modules/svelte-effect-runtime/src/generators.ts");
	if ("Effect" in mod) {
		throw new Error(
			"generators.ts must not re-export Effect. " +
				'The script transform emits `import { Effect } from "effect"` directly.',
		);
	}
});

test("generators does NOT export onMount", async () => {
	const mod = await import("../../../modules/svelte-effect-runtime/src/generators.ts");
	if ("onMount" in mod) {
		throw new Error(
			"generators.ts must not re-export onMount. " +
				'The script transform emits `import { onMount } from "svelte"` directly.',
		);
	}
});

function assert_equals<T>(actual: T, expected: T) {
	if (actual !== expected) {
		throw new Error(`Expected ${expected}, got ${actual}`);
	}
}
