import { ToEffect, get_dispatcher } from "../../../modules/svelte-effect-runtime/src/generators.ts";
import { EmptyStreamYieldError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { assert_equals, assert_exists } from "./helpers/assert.ts";
import { Cause, Effect, Exit, Stream } from "effect";
import { test } from "vitest";

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
	const dispatcher = get_dispatcher();
	const effect_value = await dispatcher.run(ToEffect(Effect.succeed("effect")));
	const stream_value = await dispatcher.run(ToEffect(Stream.make("stream", "later")));

	assert_equals(effect_value, "effect");
	assert_equals(stream_value, "stream");
});

test("ToEffect rejects empty Streams", async () => {
	const exit = await get_dispatcher().run(Effect.exit(ToEffect(Stream.empty)));
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
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
