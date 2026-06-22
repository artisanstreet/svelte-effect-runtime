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

  assertStringIncludes(error.message, "[ASYNC_EFFECT_IN_SYNC_RUNE]:");
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
    `function __SER___type_user() { return (getUser(id)); }`,
    `let user = $state<Effect.Success<ReturnType<typeof __SER___type_user>> | undefined>(undefined);`,
    `user = yield* getUser(id);`,
    `  getUser;`,
    `  id;`,
  ], [
    `let user = $derived`,
  ]);
});

Deno.test("preserves $state expressions with multiple yield points", () => {
  const source =
    `let label = $state(\`\${yield* getFirst()} \${yield* getLast()}\`);`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let label = $state<unknown>(undefined);`);
  assertStringIncludes(
    result.code,
    "label = `${yield* getFirst()} ${yield* getLast()}`;",
  );
  assertStringIncludes(result.code, `  getFirst;`);
  assertStringIncludes(result.code, `  getLast;`);
  assertNotMatch(result.code, /let label = \$derived/);
});

Deno.test("preserves $state.raw(yield* expr) as raw state", () => {
  const source = `let raw = $state.raw(yield* getRaw(id));`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `let raw = $state.raw<Effect.Success<ReturnType<typeof __SER___type_raw>> | undefined>(undefined);`,
  );
  assertStringIncludes(result.code, `raw = yield* getRaw(id);`);
  assertStringIncludes(result.code, `  getRaw;`);
  assertStringIncludes(result.code, `  id;`);
  assertNotMatch(result.code, /let raw = \$derived/);
});

Deno.test("extracts bare yield const sugar into a boundary-compatible await", () => {
  const source = `const user = yield* getUser(id);`;
  const result = assert_transform(source, [
    `function* __SER___effect_user() { return (yield* getUser(id)); }`,
    `import { get_dispatcher } from "svelte-effect-runtime/internal/generators"`,
    `const user = await get_dispatcher().promise({`,
    `id: "Test.svelte:13:31"`,
    `deps: [getUser, id]`,
    `factory: () => __SER___effect_user()`,
  ]);

  assertNotMatch(result.code, /\|\s*undefined/);
  assertNotMatch(result.code, /let user = \$derived/);
  assertNotMatch(result.code, /\$effect\(\(\) =>/);
  assertNotMatch(result.code, /import \{ Effect \} from "effect"/);
  assertNotMatch(result.code, /import \{ untrack \} from "svelte"/);
});

Deno.test("wraps lowered assignments in dependency-tracked Effect.gen", () => {
  const source = `let x = $state(yield* f());`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Effect.gen(function* () {`);
  assertStringIncludes(result.code, `$effect(() => {`);
  assertStringIncludes(result.code, `  f;`);
  assertStringIncludes(result.code, `get_dispatcher();`);
  assertStringIncludes(
    result.code,
    `untrack(() => __SER___dispatcher.fork(__SER___program));`,
  );
  assertStringIncludes(result.code, `return `);
});

Deno.test("tracks reactive identifiers read by yielded remote arguments", () => {
  const source = [
    `let { params } = $props();`,
    `let result = $derived(yield* getPost({ param: params.page_parameter }));`,
  ].join("\n");
  const result = transform_script_effect(source, "Page.svelte");

  assertStringIncludes(result.code, `let { params } = $props();`);
  assertStringIncludes(result.code, `let result = $derived(__SER___`);
  assertStringIncludes(result.code, `  getPost;`);
  assertStringIncludes(result.code, `  params;`);
  assertStringIncludes(
    result.code,
    `__SER___result = yield* getPost({ param: params.page_parameter });`,
  );
});

// ─── Destructuring yield* lowering ───────────────────────────

Deno.test("extracts destructuring yield* into temp binding", () => {
  const source = `const { title, body } = yield* getPost(id);`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER___`);
  assertStringIncludes(result.code, `= $state<`);
  assertStringIncludes(result.code, `let title = $state<unknown>(undefined);`);
  assertStringIncludes(result.code, `let body = $state<unknown>(undefined);`);
  assertStringIncludes(result.code, `= yield* getPost(id);`);
  assertStringIncludes(result.code, `({ title, body }`);
  assertNotMatch(
    result.code,
    /let __SER___destructure = \$state\(undefined\);\s*let __SER___destructure = \$state\(undefined\);/,
  );
  assertNotMatch(result.code, /let \{ title, body \}/);
});

// ─── $derived(yield* expr) lowering ──────────────────────────

Deno.test("extracts $derived(yield* expr) into a temp binding", () => {
  const source = `let msg = $derived(yield* format(user) + "!");`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER___`);
  assertStringIncludes(result.code, `= $state<`);
  assertStringIncludes(result.code, `let msg = $derived(__SER___`);
  assertStringIncludes(result.code, `+ "!"`);
  assertStringIncludes(result.code, `= yield* format(user);`);
});

// ─── $inspect lowering ───────────────────────────────────────

Deno.test("extracts $inspect(yield* expr) into a temp binding", () => {
  const source = `$inspect(yield* debugInfo());`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER___`);
  assertStringIncludes(result.code, `= $state<`);
  assertStringIncludes(result.code, `$inspect(__SER___`);
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
  assertNotMatch(result.code, /count = __SER___/);
});

Deno.test("does not track assignment targets as reactive dependencies", () => {
  const source = [
    `let count = $state(0);`,
    `count = yield* Effect.succeed(count + 1);`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `count = yield* Effect.succeed(count + 1);`,
  );
  assertStringIncludes(result.code, `  Effect;`);
  assertNotMatch(result.code, /\n\s*count;\n/);
  assertNotMatch(result.code, /void \[/);
});

Deno.test("preserves surrounding assignment RHS expressions", () => {
  const source = [
    `let value = $state(0);`,
    `value = (yield* loadValue()) + 1;`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER___value = $state<`);
  assertStringIncludes(result.code, `__SER___value = yield* loadValue();`);
  assertStringIncludes(result.code, `value = (__SER___value) + 1;`);
  assertNotMatch(result.code, /^\s{4}value = yield\* loadValue\(\);$/m);
});

Deno.test("runs compound assignments after yielded operands resolve", () => {
  const source = [
    `let count = $state(0);`,
    `count += yield* getDelta();`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER___count = $state<`);
  assertStringIncludes(result.code, `__SER___count = yield* getDelta();`);
  assertStringIncludes(result.code, `count += __SER___count;`);
  assertNotMatch(result.code, /count \+= __SER___count;\n\n\$effect/);
});

Deno.test("runs ordinary call statements after yielded arguments resolve", () => {
  const source = `recordValue(yield* loadValue());`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER___call = $state<`);
  assertStringIncludes(result.code, `__SER___call = yield* loadValue();`);
  assertStringIncludes(result.code, `recordValue(__SER___call);`);
  assertNotMatch(result.code, /^recordValue\(__SER___call\);/m);
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

Deno.test("type-only Effect import still injects a runtime Effect binding", () => {
  const source = [
    `import type { Effect } from "effect";`,
    `let value = $state(yield* loadValue());`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `import type { Effect } from "effect";`);
  assertStringIncludes(
    result.code,
    `import { Effect as __SER___Effect } from "effect";`,
  );
  assertStringIncludes(result.code, `__SER___Effect.gen(function* () {`);
});

Deno.test("local Effect binding does not collide with runtime Effect import", () => {
  const source = [
    `import { Effect } from "./local-effect";`,
    `let value = $state(yield* loadValue());`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `import { Effect } from "./local-effect";`);
  assertStringIncludes(
    result.code,
    `import { Effect as __SER___Effect } from "effect";`,
  );
  assertStringIncludes(result.code, `__SER___Effect.gen(function* () {`);
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

Deno.test("injects untrack when svelte import lacks untrack binding", () => {
  const source = [
    `import { tick } from "svelte";`,
    `let x = $state(yield* f());`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `import { tick } from "svelte";`);
  assertStringIncludes(result.code, `import { untrack } from "svelte";`);
  assertStringIncludes(result.code, `untrack(() =>`);
});

Deno.test("reuses existing untrack import when already present", () => {
  const source = [
    `import { tick, untrack } from "svelte";`,
    `let x = $state(yield* f());`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");
  const import_count =
    [...result.code.matchAll(/import.*untrack.*from.*"svelte"/g)].length;

  if (import_count !== 1) {
    throw new Error(`Expected 1 untrack import, got ${import_count}`);
  }
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

Deno.test("passes through top-level await without yield*", () => {
  const source = `const x = await fetch("/api");`;
  const result = transform_script_effect(source, "Test.svelte");

  assertEquals(result.code, source);
});

Deno.test("rejects await mixed with lowered Effect work", () => {
  const source = `const x = await transform(yield* load());`;

  const error = assertThrows(
    () => transform_script_effect(source, "Test.svelte"),
    Error,
    "await cannot be mixed with yield*",
  );

  assertStringIncludes(error.message, "[AWAIT_IN_EFFECT_WORK]:");
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

Deno.test("generates __SER___ prefix for temp bindings", () => {
  const source = `const user = yield* getUser(id);`;
  const result = transform_script_effect(source, "Test.svelte");
  assertMatch(result.code, /__SER___/);
});

Deno.test("uses __SER___program for the generated Effect.gen program", () => {
  const source = `let x = $state(yield* f());`;
  const result = transform_script_effect(source, "Test.svelte");
  assertMatch(result.code, /__SER___program/);
});

// ─── Edge cases ──────────────────────────────────────────────

Deno.test("preserves surrounding expression syntax character-for-character", () => {
  const source = `let result = $derived(yield* compute(a, b) * 2 + 1);`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `* 2 + 1`);
  assertStringIncludes(result.code, `$derived(__SER___`);
});

Deno.test("extracts every yield* expression in a compound initializer", () => {
  const source = `let result = $derived((yield* first()) + (yield* second()));`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `yield* first()`);
  assertStringIncludes(result.code, `yield* second()`);
  assertMatch(
    result.code,
    /\$derived\(\(__SER___\w+\) \+ \(__SER___\w+\)\)/,
  );
});

Deno.test("plain compound declarations become derived from yielded temps", () => {
  const source = `const value = (yield* loadValue()) + 1;`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `let __SER___value = $state<`);
  assertStringIncludes(
    result.code,
    `let value = $derived((__SER___value) + 1);`,
  );
  assertStringIncludes(result.code, `__SER___value = yield* loadValue();`);
  assertNotMatch(result.code, /const value = \(__SER___value\) \+ 1;/);
});

Deno.test("destructuring defaults with yield are assigned inside the effect body", () => {
  const source = [
    `const post = { title: undefined };`,
    `const { title = yield* getTitle() } = post;`,
  ].join("\n");
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `const post = { title: undefined };`);
  assertStringIncludes(result.code, `let title = $state<unknown>(undefined);`);
  assertStringIncludes(
    result.code,
    `({ title = yield* getTitle() } = post);`,
  );
  assertNotMatch(result.code, /const \{ title = yield\*/);
});

Deno.test("rejects yield inside class fields", () => {
  const source = [
    `class Model {`,
    `  value = yield* loadValue();`,
    `}`,
  ].join("\n");

  const error = assertThrows(
    () => transform_script_effect(source, "Test.svelte"),
    Error,
    "yield* cannot be used inside class members",
  );

  assertStringIncludes(error.message, "[ASYNC_EFFECT_IN_CLASS_MEMBER]:");
});

Deno.test("handles ternary with yield* in condition position", () => {
  const source = `let flag = $state(yield* check() ? "a" : "b");`;
  const result = transform_script_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `? "a" : "b"`);
  assertStringIncludes(result.code, `let flag = $state<`);
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
