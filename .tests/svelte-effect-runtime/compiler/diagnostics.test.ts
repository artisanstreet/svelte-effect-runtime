import { find_svelte_effect_diagnostics } from "../../../modules/svelte-effect-runtime/src/diagnostics.ts";
import { assert_equals, assert_string_includes } from "../unit/helpers/assert.ts";
import { test } from "vitest";

test("diagnostics ignore Effect references inside script and style blocks", () => {
	const source = [
		`<script>`,
		`  const value = { nested: Effect.succeed(1) };`,
		`</script>`,
		`<style>`,
		`  .button { color: red; }`,
		`</style>`,
		`<button onclick={Effect.succeed(1)}>save</button>`,
	].join("\n");
	const diagnostics = find_svelte_effect_diagnostics(source, "Button.svelte");

	assert_equals(diagnostics.length, 1);
	assert_equals(diagnostics[0].line, 7);
	assert_string_includes(diagnostics[0].message, "event attribute");
});

test("diagnostics recognize single-expression style directives as attributes", () => {
	const source = `<div style:color={Effect.succeed("red")}></div>`;
	const diagnostics = find_svelte_effect_diagnostics(source, "StyleDirective.svelte");

	assert_equals(diagnostics.length, 1);
	assert_string_includes(diagnostics[0].message, "Svelte attributes need");
});

test("diagnostics follow root and Effect module namespace imports", () => {
	const source = [
		`<script lang="ts">`,
		`  import * as Root from "effect";`,
		`  import * as Direct from "effect/Effect";`,
		`</script>`,
		`<p>{Root.Effect.succeed(1)}</p>`,
		`<p>{Direct["sync"](() => 2)}</p>`,
	].join("\n");
	const diagnostics = find_svelte_effect_diagnostics(source, "Namespaces.svelte");

	assert_equals(diagnostics.length, 2);
	assert_string_includes(diagnostics[0].message, "Root.Effect.succeed");
	assert_string_includes(diagnostics[1].message, `Direct["sync"]`);
});

test("diagnostics ignore Effect-looking text and type-only imports", () => {
	const runner_name = ["run", "Promise"].join("");
	const source = [
		`<script lang="ts">`,
		`  import type { Effect as E } from "effect";`,
		`</script>`,
		`<p>{"Effect.succeed(1)"}</p>`,
		`<p>{/** Effect.${runner_name}(Effect.void) */ value}</p>`,
		`<p>{E.succeed(1)}</p>`,
	].join("\n");
	const diagnostics = find_svelte_effect_diagnostics(source, "Text.svelte");

	assert_equals(diagnostics, []);
});

test("diagnostics ignore yielded Effect programs in Svelte tag expressions", () => {
	const source = [
		`{#if yield* Effect.succeed(true)}ready{/if}`,
		`{@const value = yield* Effect.succeed(1)}`,
		`{let direct = yield* Effect.succeed(2)}`,
		`{const nested = $derived(yield* Effect.succeed(3))}`,
		`{const { fallback = yield* Effect.succeed(4) } = data}`,
		`{const plain = 1, second = yield* Effect.succeed(5)}`,
		`{#each yield* Effect.succeed([1]) as item}<p>{item}</p>{/each}`,
		`{#await yield* Effect.succeed(1) then result}<p>{result}</p>{/await}`,
		`{@html yield* Effect.succeed("<p>ready</p>")}`,
		`{@render yield* Effect.succeed(snippet())}`,
		`{@render child(yield* Effect.succeed(snippet()))}`,
		`<p>{format(yield* Effect.succeed("ready"))}</p>`,
		`{#if\n yield* Effect.succeed(true)}multiline{/if}`,
		`{@const\n multiline = yield* Effect.succeed(6)}`,
		`{#each\n yield* Effect.succeed([1])\n as item}<p>{item}</p>{/each}`,
		`{#await\n yield* Effect.succeed(1)\n then result}<p>{result}</p>{/await}`,
	].join("\n");
	const diagnostics = find_svelte_effect_diagnostics(source, "Tags.svelte");

	assert_equals(diagnostics, []);
});

test("diagnostics retain unyielded Effect programs in mixed declarations", () => {
	const source = `{const managed = yield* Effect.succeed(1), unmanaged = Effect.succeed(2)}`;
	const diagnostics = find_svelte_effect_diagnostics(source, "Mixed.svelte");

	assert_equals(diagnostics.length, 1);
	assert_string_includes(diagnostics[0].message, "will produce an Effect value");
});

test("diagnostics keep await context keywords inside nested expressions", () => {
	const source = `{#await (() => " then " && Effect.succeed(1))() then value}{value}{/await}`;
	const diagnostics = find_svelte_effect_diagnostics(source, "Await.svelte");

	assert_equals(diagnostics.length, 1);
	assert_string_includes(diagnostics[0].message, "Effect.succeed");
});

test("diagnostics distinguish callback yields from nested generator yields", () => {
	const nested_generator = [
		`<button onclick={() => Effect.gen(function* () {`,
		`  yield* Effect.succeed(1);`,
		`})}>nested</button>`,
	].join("\n");
	const hidden_yield = `<button onclick={() => yield* Effect.succeed(1)}>hidden</button>`;
	const nested_diagnostics = find_svelte_effect_diagnostics(nested_generator, "Nested.svelte");
	const hidden_diagnostics = find_svelte_effect_diagnostics(hidden_yield, "Hidden.svelte");

	assert_equals(nested_diagnostics.length, 1);
	assert_string_includes(nested_diagnostics[0].message, "returns an Effect");
	assert_equals(hidden_diagnostics.length, 1);
	assert_string_includes(hidden_diagnostics[0].message, "yield* hidden inside");
});

test("diagnostics scan many markup expressions near linearly", () => {
	const small_source = make_many_markup_expressions(4_000);
	const large_source = make_many_markup_expressions(32_000);

	find_svelte_effect_diagnostics(make_many_markup_expressions(10), "Warmup.svelte");

	const small_elapsed = measure_diagnostics_elapsed_ms(small_source);
	const large_elapsed = measure_diagnostics_elapsed_ms(large_source);
	const allowed_large_elapsed = small_elapsed * 16 + 500;

	if (large_elapsed > allowed_large_elapsed) {
		throw new Error(
			[
				`expected diagnostics scan to stay near-linear`,
				`small elapsed: ${small_elapsed.toFixed(1)}ms`,
				`large elapsed: ${large_elapsed.toFixed(1)}ms`,
				`allowed large elapsed: ${allowed_large_elapsed.toFixed(1)}ms`,
			].join("\n"),
		);
	}
});

test("diagnostics parse candidate expressions near linearly", () => {
	const small_source = make_many_effect_expressions(500);
	const large_source = make_many_effect_expressions(4_000);

	find_svelte_effect_diagnostics(make_many_effect_expressions(10), "Warmup.svelte");

	const small_elapsed = measure_candidate_diagnostics_elapsed_ms(small_source, 500);
	const large_elapsed = measure_candidate_diagnostics_elapsed_ms(large_source, 4_000);
	const allowed_large_elapsed = small_elapsed * 16 + 750;

	if (large_elapsed > allowed_large_elapsed) {
		throw new Error(
			[
				`expected candidate diagnostics parsing to stay near-linear`,
				`small elapsed: ${small_elapsed.toFixed(1)}ms`,
				`large elapsed: ${large_elapsed.toFixed(1)}ms`,
				`allowed large elapsed: ${allowed_large_elapsed.toFixed(1)}ms`,
			].join("\n"),
		);
	}
});

function measure_diagnostics_elapsed_ms(source: string): number {
	const start = performance.now();

	const diagnostics = find_svelte_effect_diagnostics(source, "Dos.svelte");
	const elapsed = performance.now() - start;

	assert_equals(diagnostics.length, 1);

	return elapsed;
}

function make_many_markup_expressions(count: number): string {
	const repeated_markup = Array.from({ length: count }, () => `<p>{value}</p>`).join("");

	return `${repeated_markup}<p>{Effect.succeed(1)}</p>`;
}

function measure_candidate_diagnostics_elapsed_ms(source: string, expected_count: number): number {
	const start = performance.now();

	const diagnostics = find_svelte_effect_diagnostics(source, "Candidates.svelte");
	const elapsed = performance.now() - start;

	assert_equals(diagnostics.length, expected_count);

	return elapsed;
}

function make_many_effect_expressions(count: number): string {
	const script = `<script>import { Effect as E } from "effect";</script>`;
	const markup = Array.from({ length: count }, (_, index) => `<p>{E.succeed(${index})}</p>`).join(
		"",
	);

	return script + markup;
}
