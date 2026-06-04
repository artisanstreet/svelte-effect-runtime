import {
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { transform_script_effect } from "../../../modules/svelte-effect-runtime/src/preprocess.ts";
import type { ScriptTransformResult } from "../../../modules/svelte-effect-runtime/src/preprocess.ts";

function assert_transform(
  source: string,
  must_contain: string[],
  must_not_contain: string[] = [],
): ScriptTransformResult {
  const result = transform_script_effect(source, "Test.svelte");
  for (const fragment of must_contain) {
    assertStringIncludes(result.code, fragment);
  }
  for (const fragment of must_not_contain) {
    assertNotMatch(
      result.code,
      new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  return result;
}

function assert_rejects_rune_yield(source: string, rune_name?: string): void {
  const error = assertThrows(
    () => transform_script_effect(source, "Test.svelte"),
    Error,
    "yield* cannot be used inside",
  );

  assertStringIncludes(error.message, "must stay synchronous");
  assertNotMatch(error.message, /Extract|__temp|yourEffect|\$state\(yield\*/);

  if (rune_name) {
    assertStringIncludes(error.message, rune_name);
  }
}

// ─── Pass-through (identity) tests ───────────────────────────

Deno.test("passes through a regular script body unchanged (no yield*)", () => {
  const source = [
    `import { foo } from "./bar";`,
    `function greet(name: string) {`,
    `  return "hello " + name;`,
    `}`,
    `const x = 42;`,
    `let y = $state(0);`,
    `$effect(() => {`,
    `  console.log(y);`,
    `});`,
  ].join("\n");

  const result = transform_script_effect(source, "Test.svelte");
  assertStringIncludes(result.code, `import { foo } from "./bar";`);
  assertStringIncludes(result.code, `function greet(name: string) {`);
  assertStringIncludes(result.code, `const x = 42;`);
  assertStringIncludes(result.code, `let y = $state(0);`);
  assertStringIncludes(result.code, `$effect(() => {`);
  assertNotMatch(result.code, /__SER__/);
  assertNotMatch(result.code, /onMount/);
  assertNotMatch(result.code, /get_dispatcher/);
});

Deno.test("passes through ordinary Svelte rune usage unchanged", () => {
  const source = [
    `let count = $state(0);`,
    `let raw = $state.raw({ value: 1 });`,
    `const snapshot = $state.snapshot(raw);`,
    `const doubled = $derived(count * 2);`,
    `const tripled = $derived.by(() => count * 3);`,
    `let { value = $bindable("x"), ...rest } = $props();`,
    `const props_id = $props.id();`,
    `$effect(() => { console.log(count); });`,
    `$effect.pre(() => { console.log("pre", count); });`,
    `const dispose = $effect.root(() => { console.log(count); });`,
    `const pending = $effect.pending();`,
    `const tracking = $effect.tracking();`,
    `$inspect(count, doubled).with((type, value) => console.log(type, value));`,
    `$inspect.trace("count");`,
    `const host = $host();`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertEquals(result.code, source);
  assertNotMatch(result.code, /__SER__/);
});

Deno.test("passes through types, interfaces, enums, classes untouched", () => {
  const source = [
    `type User = { name: string };`,
    `interface Post { title: string }`,
    `enum Kind { A, B }`,
    `class Helper { greet() { return "hi"; } }`,
  ].join("\n");

  const result = transform_script_effect(source, "Test.svelte");
  assertStringIncludes(result.code, `type User = { name: string };`);
  assertStringIncludes(result.code, `interface Post { title: string }`);
  assertStringIncludes(result.code, `enum Kind { A, B }`);
  assertStringIncludes(
    result.code,
    `class Helper { greet() { return "hi"; } }`,
  );
});

// ─── $state(yield* expr) lowering ────────────────────────────

Deno.test("preserves $state(yield* expr) as writable state", () => {
  const source = `let user = $state(yield* getUser(id));`;
  assert_transform(source, [
    `let user = $state(undefined);`,
    `user = yield* getUser(id);`,
    `void [getUser, id];`,
  ], [
    `let user = $derived`,
  ]);
});

Deno.test("preserves $state expressions with multiple yield points", () => {
  const source =
    `let label = $state(\`\${yield* getFirst()} \${yield* getLast()}\`);`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let label = $state(undefined);`);
  assertStringIncludes(
    result.code,
    "label = `${yield* getFirst()} ${yield* getLast()}`;",
  );
  assertStringIncludes(result.code, `void [getFirst, getLast];`);
  assertNotMatch(result.code, /let label = \$derived/);
});

Deno.test("preserves $state.raw(yield* expr) as raw state", () => {
  const source = `let raw = $state.raw(yield* getRaw(id));`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let raw = $state.raw(undefined);`);
  assertStringIncludes(result.code, `raw = yield* getRaw(id);`);
  assertStringIncludes(result.code, `void [getRaw, id];`);
  assertNotMatch(result.code, /let raw = \$derived/);
});

Deno.test("extracts bare yield const sugar into a derived value", () => {
  const source = `const user = yield* getUser(id);`;
  assert_transform(source, [
    `let __SER__`,
    `= $state(undefined);`,
    `let user = $derived(__SER__`,
    `= yield* getUser(id);`,
    `import { Effect } from "effect"`,
    `import { get_dispatcher } from "svelte-effect-runtime/internal/generators"`,
    `$effect(() => {`,
    `void [getUser, id];`,
  ]);
});

Deno.test("wraps lowered assignments in dependency-tracked Effect.gen", () => {
  const source = `let x = $state(yield* f());`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Effect.gen(function* () {`);
  assertStringIncludes(result.code, `$effect(() => {`);
  assertStringIncludes(result.code, `void [f];`);
  assertStringIncludes(result.code, `get_dispatcher();`);
  assertStringIncludes(result.code, `.fork(`);
  assertStringIncludes(result.code, `return `);
});

Deno.test("tracks reactive identifiers read by yielded remote arguments", () => {
  const source = [
    `let { params } = $props();`,
    `let result = $derived(yield* getPost({ param: params.page_parameter }));`,
  ].join("\n");
  const result = transform_script_effect(source, "Page.svelte");

  assertStringIncludes(result.code, `let { params } = $props();`);
  assertStringIncludes(result.code, `let result = $derived(__SER__`);
  assertStringIncludes(result.code, `void [getPost, params];`);
  assertStringIncludes(
    result.code,
    `__SER__result = yield* getPost({ param: params.page_parameter });`,
  );
});

// ─── Destructuring yield* lowering ───────────────────────────

Deno.test("extracts destructuring yield* into temp binding", () => {
  const source = `const { title, body } = yield* getPost(id);`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER__`);
  assertStringIncludes(result.code, `= $state(undefined);`);
  assertStringIncludes(result.code, `let title = $state(undefined);`);
  assertStringIncludes(result.code, `let body = $state(undefined);`);
  assertStringIncludes(result.code, `= yield* getPost(id);`);
  assertStringIncludes(result.code, `({ title, body }`);
  assertNotMatch(
    result.code,
    /let __SER__destructure = \$state\(undefined\);\s*let __SER__destructure = \$state\(undefined\);/,
  );
  assertNotMatch(result.code, /let \{ title, body \}/);
});

// ─── $derived(yield* expr) lowering ──────────────────────────

Deno.test("extracts $derived(yield* expr) into a temp binding", () => {
  const source = `let msg = $derived(yield* format(user) + "!");`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER__`);
  assertStringIncludes(result.code, `= $state(undefined);`);
  assertStringIncludes(result.code, `let msg = $derived(__SER__`);
  assertStringIncludes(result.code, `+ "!"`);
  assertStringIncludes(result.code, `= yield* format(user);`);
});

// ─── $inspect lowering ───────────────────────────────────────

Deno.test("extracts $inspect(yield* expr) into a temp binding", () => {
  const source = `$inspect(yield* debugInfo());`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER__`);
  assertStringIncludes(result.code, `= $state(undefined);`);
  assertStringIncludes(result.code, `$inspect(__SER__`);
  assertStringIncludes(result.code, `= yield* debugInfo();`);
});

// ─── Assignment expressions with yield* ──────────────────────

Deno.test("moves count = yield* expr into the effect body", () => {
  const source = [
    `let count = $state(0);`,
    `count = yield* getCount();`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let count = $state(0);`);
  assertStringIncludes(result.code, `count = yield* getCount();`);
  assertNotMatch(result.code, /count = __SER__/);
});

// ─── Bare yield* statement (fire and forget) ─────────────────

Deno.test("moves bare yield* statements into the effect body", () => {
  const source = `yield* logView(userId);`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `yield* logView(userId);`);
  assertStringIncludes(result.code, `Effect.gen(function*`);
});

// ─── NOT lowered (function boundary) ─────────────────────────

Deno.test("rejects yield* inside a $effect arrow function", () => {
  const source = `$effect(() => { yield* doThing(); });`;

  assert_rejects_rune_yield(source, "$effect");
});

Deno.test("does NOT lower yield* in Effect.gen inside a const declaration", () => {
  const source = `const program = Effect.gen(function* () { yield* foo(); });`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `const program = Effect.gen(function* () { yield* foo(); });`,
  );
  assertNotMatch(result.code, /__SER__/);
});

// ─── Multiple yield* in one file ─────────────────────────────

Deno.test("handles multiple yield* expressions in one script", () => {
  const source = [
    `let a = $state(yield* f1());`,
    `const b = yield* f2();`,
    `yield* log("done");`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  const gen_count =
    (result.code.match(/Effect\.gen\(function\*/g) ?? []).length;
  const effect_count = (result.code.match(/\$effect\(\(\) =>/g) ?? []).length;
  if (gen_count !== 1) {
    throw new Error(`Expected 1 Effect.gen, got ${gen_count}`);
  }
  if (effect_count !== 1) {
    throw new Error(`Expected 1 $effect, got ${effect_count}`);
  }
});

// ─── Import handling ─────────────────────────────────────────

Deno.test("injects Effect import when not already present", () => {
  const source = `let x = $state(yield* f());`;
  const result = transform_script_effect(source, "Test.svelte");
  assertStringIncludes(result.code, `import { Effect } from "effect"`);
});

Deno.test("reuses existing Effect import when already present", () => {
  const source = [
    `import { Effect, Schema } from "effect";`,
    `let x = $state(yield* f());`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");
  const import_count =
    [...result.code.matchAll(/import.*Effect.*from.*"effect"/g)].length;
  if (import_count !== 1) {
    throw new Error(`Expected 1 Effect import, got ${import_count}`);
  }
});

Deno.test("injects Effect when effect module import lacks Effect binding", () => {
  const source = [
    `import { pipe } from "effect";`,
    `let x = $state(yield* f());`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `import { pipe } from "effect";`);
  assertStringIncludes(result.code, `import { Effect } from "effect";`);
  assertStringIncludes(result.code, `Effect.gen(function* () {`);
});

Deno.test("does not inject onMount for dependency-tracked runtime block", () => {
  const source = [
    `import { tick } from "svelte";`,
    `let x = $state(yield* f());`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `import { tick } from "svelte";`);
  assertNotMatch(result.code, /import \{ onMount \} from "svelte";/);
  assertStringIncludes(result.code, `$effect(() => {`);
});

Deno.test("injects dispatcher when generators import lacks get_dispatcher binding", () => {
  const source = [
    `import { value } from "svelte-effect-runtime/internal/generators";`,
    `let x = $state(yield* f());`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `import { get_dispatcher } from "svelte-effect-runtime/internal/generators";`,
  );
  assertStringIncludes(result.code, `get_dispatcher();`);
});

// ─── Error cases ─────────────────────────────────────────────

Deno.test("rejects top-level await with a clear error message", () => {
  const source = `const x = await fetch("/api");`;
  assertThrows(
    () => transform_script_effect(source, "Test.svelte"),
    Error,
    "await",
  );
});

Deno.test("rejects yield* in synchronous-only rune arguments", () => {
  const cases = [
    `const snapshot = $state.snapshot(yield* getSnapshot());`,
    `let { value = $bindable(yield* getFallback()) } = $props();`,
    `const props = $props(yield* getProps());`,
    `const id = $props.id(yield* getId());`,
    `const host = $host(yield* getHost());`,
    `const pending = $effect.pending(yield* getPending());`,
    `const tracking = $effect.tracking(yield* getTracking());`,
  ];

  for (const source of cases) {
    assert_rejects_rune_yield(source);
  }
});

Deno.test("rejects yield* inside synchronous rune callbacks", () => {
  const cases = [
    `$effect(() => yield* runEffect());`,
    `$effect.pre(() => yield* runPreEffect());`,
    `$effect.root(() => yield* runRootEffect());`,
    `const value = $derived.by(() => yield* compute());`,
  ];

  for (const source of cases) {
    assert_rejects_rune_yield(source);
  }
});

// ─── Generated naming conventions ────────────────────────────

Deno.test("generates __SER__ prefix for temp bindings", () => {
  const source = `const user = yield* getUser(id);`;
  const result = transform_script_effect(source, "Test.svelte");
  assertMatch(result.code, /__SER__/);
});

Deno.test("uses __SER__program for the generated Effect.gen program", () => {
  const source = `let x = $state(yield* f());`;
  const result = transform_script_effect(source, "Test.svelte");
  assertMatch(result.code, /__SER__program/);
});

// ─── Edge cases ──────────────────────────────────────────────

Deno.test("preserves surrounding expression syntax character-for-character", () => {
  const source = `let result = $derived(yield* compute(a, b) * 2 + 1);`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `* 2 + 1`);
  assertStringIncludes(result.code, `$derived(__SER__`);
});

Deno.test("extracts every yield* expression in a compound initializer", () => {
  const source = `let result = $derived((yield* first()) + (yield* second()));`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `yield* first()`);
  assertStringIncludes(result.code, `yield* second()`);
  assertMatch(result.code, /\$derived\(\(__SER__\w+\) \+ \(__SER__\w+\)\)/);
});

Deno.test("handles ternary with yield* in condition position", () => {
  const source = `let flag = $state(yield* check() ? "a" : "b");`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `? "a" : "b"`);
  assertStringIncludes(result.code, `let flag = $state(undefined);`);
  assertStringIncludes(result.code, `flag = yield* check() ? "a" : "b";`);
});

Deno.test("does not choke on $props() or $bindable declarations", () => {
  const source = [
    `let { name, age } = $props();`,
    `let value = $bindable(0);`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `$props()`);
  assertStringIncludes(result.code, `$bindable(0)`);
  assertNotMatch(result.code, /__SER__/);
});
