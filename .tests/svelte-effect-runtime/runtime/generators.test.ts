import { test } from "vitest";
import { assert_equals, assert_exists, assert_rejects } from "./helpers/assert.ts";
import { Effect, Stream } from "effect";
import { EmptyStreamYieldError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { ToEffect } from "../../../modules/svelte-effect-runtime/src/generators.ts";

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

test("ToEffect normalizes Effects and Streams", async () => {
	const effect_value = await Effect.runPromise(ToEffect(Effect.succeed("effect")));
	const stream_value = await Effect.runPromise(ToEffect(Stream.make("stream", "later")));

	assert_equals(effect_value, "effect");
	assert_equals(stream_value, "stream");
});

test("ToEffect rejects empty Streams", async () => {
	const error = await assert_rejects(() => Effect.runPromise(ToEffect(Stream.empty)));

	assert_equals(error instanceof EmptyStreamYieldError, true);
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
