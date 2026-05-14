import { assertMatch, assertNotMatch, assertStringIncludes } from "@std/assert";
import { transform_markup_effect } from "../../../modules/svelte-effect-runtime/src/markup/transform.ts";

// ─── Identity / pass-through ─────────────────────────────────

Deno.test("passes through markup with no yield* unchanged", () => {
  const source = `<h1>Hello</h1><p>World</p>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `<h1>Hello</h1>`);
  assertStringIncludes(result.code, `<p>World</p>`);
  if (result.has_yield) throw new Error("has_yield should be false");
});

Deno.test("passes through markup with yield* inside a generator (function boundary)", () => {
  const source = `<span>{Effect.gen(function* () { yield* foo(); })}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  // The yield* is inside function* — NOT top-level — so it should pass through
  assertStringIncludes(result.code, `yield*`);
  if (result.has_yield) throw new Error("has_yield should be false");
});

Deno.test("fast-path returns identity for files with no yield* text", () => {
  const source = `<h1>Nothing here</h1>`;
  const result = transform_markup_effect(source, "Test.svelte");

  if (result.code !== source) throw new Error("expected identity output");
  if (result.has_yield) throw new Error("has_yield should be false");
});

// ─── Plain expressions ───────────────────────────────────────

Deno.test("rewrites {yield* expr} as value() call", () => {
  const source = `<span>{yield* renderDate()}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
  assertStringIncludes(result.code, `renderDate()`);
  assertStringIncludes(result.code, `function* ()`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {yield* expr} with free identifier deps", () => {
  const source = `<span>{yield* format(user)}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
  assertStringIncludes(result.code, `format`);
  assertStringIncludes(result.code, `user`);
});

// ─── Block expressions ───────────────────────────────────────

Deno.test("rewrites {#if yield* expr} in condition", () => {
  const source = `{#if yield* hasAccess()}<p>yes</p>{/if}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
  assertStringIncludes(result.code, `hasAccess`);
  assertStringIncludes(result.code, `{#if`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#each yield* expr as item} in list", () => {
  const source = `{#each yield* getItems() as item}<li>{item}</li>{/each}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
  assertStringIncludes(result.code, `getItems`);
  assertStringIncludes(result.code, `{#each`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#await yield* expr} as promise() call", () => {
  const source = `{#await yield* loadData()}<p>loading</p>{:then val}<p>{val}</p>{/await}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_promise`);
  assertStringIncludes(result.code, `loadData`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {@render yield* fn()} as IIFE value()", () => {
  const source = `{@render yield* getSnippet()}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
  // Render tags wrap in IIFE: (value(...))()
  assertStringIncludes(result.code, `(`);
  assertStringIncludes(result.code, `)()`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {@const x = yield* expr} in const initializer", () => {
  const source = `{@const x = yield* compute()}{x}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
  assertStringIncludes(result.code, `compute`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#key yield* expr} in key expression", () => {
  const source = `{#key yield* getKey()}<p>content</p>{/key}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
  assertStringIncludes(result.code, `getKey`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

// ─── Event handlers ──────────────────────────────────────────

Deno.test("rewrites on:click event with yield* as run() wrapper", () => {
  const source = `<button on:click={() => yield* handleClick()}>click</button>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_run`);
  assertStringIncludes(result.code, `handleClick`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites onclick event with yield* as run() wrapper", () => {
  const source = `<button onclick={() => yield* trackEvent()}>click</button>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_run`);
  assertStringIncludes(result.code, `trackEvent`);
});

// ─── Multiple yield* in one file ─────────────────────────────

Deno.test("handles multiple yield* expressions in markup", () => {
  const source = [
    `<p>{yield* getA()}</p>`,
    `<p>{yield* getB()}</p>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  /** Count actual helper call sites (not import aliases). */
  const value_calls = [...result.code.matchAll(/\b__ser_markup_value\(/g)].length;
  if (value_calls !== 2) throw new Error(`expected 2 value calls, got ${value_calls}`);
});

// ─── Script tag injection ────────────────────────────────────

Deno.test("injects helper imports into existing instance script tag", () => {
  const source = [
    `<script>let x = 1;</script>`,
    `<p>{yield* getValue()}</p>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `from "svelte-effect-runtime/generators"`);
  assertStringIncludes(result.code, `let x = 1;`);
  // The original content must be preserved
  assertStringIncludes(result.code, `<p>`);
});

Deno.test("creates a script tag when none exists", () => {
  const source = `<p>{yield* getValue()}</p>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `<script>`);
  assertStringIncludes(result.code, `</script>`);
  assertStringIncludes(result.code, `from "svelte-effect-runtime/generators"`);
});

Deno.test("skips module context script tags", () => {
  const source = [
    `<script context="module">export const preload = () => {};</script>`,
    `<p>{yield* getValue()}</p>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  // Must inject into a new script, not the module one
  const script_count = [...result.code.matchAll(/<script\b/g)].length;
  if (script_count < 2) throw new Error("expected at least 2 script tags");
});

// ─── Idempotency ─────────────────────────────────────────────

Deno.test("is idempotent across repeated preprocess passes", () => {
  const source = `<p>{yield* getValue()}</p>`;
  const first = transform_markup_effect(source, "Test.svelte");
  const second = transform_markup_effect(first.code, "Test.svelte");

  if (second.code !== first.code) {
    throw new Error("second pass should produce identical output");
  }
});

// ─── Edge cases ──────────────────────────────────────────────

Deno.test("does not choke on empty yield* brace contents", () => {
  const source = `<span>{yield* }</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  // Regex match on yield* passes, but TS parser fails — should not crash
  if (result.has_yield) {
    // If it detected yield*, the output should still be valid
    assertStringIncludes(result.code, `__ser_markup_value`);
  }
});

Deno.test("does not choke on template literal expressions", () => {
  const source = `<span>{yield* \`prefix-\${id}\`}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
});
