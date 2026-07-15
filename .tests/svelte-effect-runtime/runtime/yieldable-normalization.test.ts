import { EmptyStreamYieldError, InvalidYieldableError } from "svelte-effect-runtime";
import { ToEffect, get_dispatcher } from "svelte-effect-runtime/internal/generators";
import { reset_dispatcher } from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { assert_equals, assert_rejects } from "../unit/helpers/assert.ts";
import { Effect, Stream } from "effect";
import { afterEach, test } from "vitest";

afterEach(() => {
	reset_dispatcher();
});

test("ToEffect preserves Effect, generator, and first Stream values through the generated dispatcher boundary", async () => {
	const dispatcher = get_dispatcher();
	const GeneratorValue = (function* () {
		return yield* Effect.succeed("generator");
	})();

	const effect_value = await dispatcher.promise({
		id: "yieldable-effect",
		deps: [],
		factory: function* () {
			return yield* ToEffect(Effect.succeed("effect"));
		},
	});
	const generator_value = await dispatcher.promise({
		id: "yieldable-generator",
		deps: [],
		factory: function* () {
			return yield* ToEffect(GeneratorValue);
		},
	});
	const stream_value = await dispatcher.promise({
		id: "yieldable-stream",
		deps: [],
		factory: function* () {
			return yield* ToEffect(Stream.make("first", "unreachable"));
		},
	});

	assert_equals(effect_value, "effect");
	assert_equals(generator_value, "generator");
	assert_equals(stream_value, "first");
});

test("ToEffect reports EmptyStreamYieldError when a generated yield consumes a Stream without values", async () => {
	const dispatcher = get_dispatcher();

	const error = await assert_rejects(
		() =>
			dispatcher.promise({
				id: "yieldable-empty-stream",
				deps: [],
				factory: function* () {
					return yield* ToEffect(Stream.empty);
				},
			}),
		EmptyStreamYieldError,
	);

	assert_equals(error.name, "EmptyStreamYieldError");
	assert_equals(
		error.message,
		"Cannot resolve yield* stream expression because the Stream completed without emitting a value.",
	);
});

test("ToEffect reports InvalidYieldableError when generated code receives an invalid value", async () => {
	const dispatcher = get_dispatcher();

	const error = await assert_rejects(
		() =>
			dispatcher.promise({
				id: "yieldable-invalid-value",
				deps: [],
				factory: function* () {
					return yield* ToEffect(null as never);
				},
			}),
		InvalidYieldableError,
	);

	assert_equals(error.name, "InvalidYieldableError");
	assert_equals(error.value, null);
	assert_equals(
		error.message,
		"Cannot resolve yield* expression because it returned a non-yieldable value. Expected an Effect, generator, or Stream.",
	);
});
