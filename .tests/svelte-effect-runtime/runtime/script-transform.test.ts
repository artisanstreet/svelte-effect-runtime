import { test } from "vitest";
import {
	assert_match,
	assert_equals,
	assert_throws,
	assert_not_match,
	assert_string_includes,
} from "./helpers/assert.ts";
import { transform_script_effect } from "../../../modules/svelte-effect-runtime/src/script-transform/index.ts";
import type { ScriptTransformResult } from "../../../modules/svelte-effect-runtime/src/script-transform/index.ts";

function assert_transform(
	source: string,
	must_contain: string[],
	must_not_contain: string[] = [],
): ScriptTransformResult {
	const result = transform_script_effect(source, "Test.svelte");
	for (const fragment of must_contain) {
		assert_string_includes(result.code, fragment);
	}
	for (const fragment of must_not_contain) {
		assert_not_match(result.code, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
	return result;
}

function assert_rejects_rune_yield(source: string, rune_name?: string): void {
	const error = assert_throws(
		() => transform_script_effect(source, "Test.svelte"),
		Error,
		"yield* cannot be used inside",
	);

	assert_string_includes(error.message, "[ASYNC_EFFECT_IN_SYNC_RUNE]:");
	assert_string_includes(error.message, "must stay synchronous");
	assert_not_match(error.message, /Extract|__temp|yourEffect|\$state\(yield\*/);

	if (rune_name) {
		assert_string_includes(error.message, rune_name);
	}
}

// ─── Pass-through (identity) tests ───────────────────────────

test("passes through a regular script body unchanged (no yield*)", () => {
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
	assert_string_includes(result.code, `import { foo } from "./bar";`);
	assert_string_includes(result.code, `function greet(name: string) {`);
	assert_string_includes(result.code, `const x = 42;`);
	assert_string_includes(result.code, `let y = $state(0);`);
	assert_string_includes(result.code, `$effect(() => {`);
	assert_not_match(result.code, /__SER__/);
	assert_not_match(result.code, /onMount/);
	assert_not_match(result.code, /get_dispatcher/);
});

test("passes through ordinary Svelte rune usage unchanged", () => {
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

	assert_equals(result.code, source);
	assert_not_match(result.code, /__SER__/);
});

test("passes through types, interfaces, enums, classes untouched", () => {
	const source = [
		`type User = { name: string };`,
		`interface Post { title: string }`,
		`enum Kind { A, B }`,
		`class Helper { greet() { return "hi"; } }`,
	].join("\n");

	const result = transform_script_effect(source, "Test.svelte");
	assert_string_includes(result.code, `type User = { name: string };`);
	assert_string_includes(result.code, `interface Post { title: string }`);
	assert_string_includes(result.code, `enum Kind { A, B }`);
	assert_string_includes(result.code, `class Helper { greet() { return "hi"; } }`);
});

// ─── $state(yield* expr) lowering ────────────────────────────

test("preserves $state(yield* expr) as writable state", () => {
	const source = `let user = $state(yield* getUser(id));`;
	assert_transform(
		source,
		[
			`function* __SER___effect_user() { return (yield* getUser(id)); }`,
			`let user = $state(await get_dispatcher().promise({`,
			`deps: [getUser, id]`,
			`factory: () => __SER___effect_user()`,
		],
		[`let user = $derived`, `$state<`, `$effect(() =>`, `| undefined`],
	);
});

test("preserves $state expressions with multiple yield points", () => {
	const source = `let label = $state(\`\${yield* getFirst()} \${yield* getLast()}\`);`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`function* __SER___effect_label() { return (yield* getFirst()); }`,
	);
	assert_string_includes(
		result.code,
		`function* __SER___effect_label_1() { return (yield* getLast()); }`,
	);
	assert_string_includes(result.code, "let label = $state(`${await get_dispatcher().promise({");
	assert_string_includes(result.code, `deps: [getFirst]`);
	assert_string_includes(result.code, `deps: [getLast]`);
	assert_not_match(result.code, /let label = \$derived/);
	assert_not_match(result.code, /\$state<unknown>\(undefined\)/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

test("preserves $state.raw(yield* expr) as raw state", () => {
	const source = `let raw = $state.raw(yield* getRaw(id));`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`function* __SER___effect_raw() { return (yield* getRaw(id)); }`,
	);
	assert_string_includes(result.code, `let raw = $state.raw(await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [getRaw, id]`);
	assert_not_match(result.code, /let raw = \$derived/);
	assert_not_match(result.code, /\$state\.raw<.*undefined/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

test("extracts bare yield const sugar into a boundary-compatible await", () => {
	const source = `const user = yield* getUser(id);`;
	const result = assert_transform(source, [
		`function* __SER___effect_user() { return (yield* getUser(id)); }`,
		`import { get_dispatcher } from "svelte-effect-runtime/internal/generators"`,
		`const user = await get_dispatcher().promise({`,
		`id: "Test.svelte:13:31"`,
		`deps: [getUser, id]`,
		`factory: () => __SER___effect_user()`,
	]);

	assert_not_match(result.code, /\|\s*undefined/);
	assert_not_match(result.code, /let user = \$derived/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
	assert_not_match(result.code, /import \{ Effect \} from "effect"/);
	assert_not_match(result.code, /import \{ untrack \} from "svelte"/);
});

test("keeps state declarations out of dependency-tracked Effect.gen", () => {
	const source = `let x = $state(yield* f());`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `let x = $state(await get_dispatcher().promise({`);
	assert_string_includes(result.code, `function* __SER___effect_x() { return (yield* f()); }`);
	assert_not_match(result.code, /Effect\.gen\(function\*/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
	assert_not_match(result.code, /untrack\(\(\) =>/);
});

test("tracks reactive identifiers read by yielded remote arguments", () => {
	const source = [
		`let { params } = $props();`,
		`let result = $derived(yield* getPost({ param: params.page_parameter }));`,
	].join("\n");
	const result = transform_script_effect(source, "Page.svelte");

	assert_string_includes(result.code, `let { params } = $props();`);
	assert_string_includes(result.code, `let result = $derived(await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [getPost, params]`);
	assert_string_includes(
		result.code,
		`function* __SER___effect_result() { return (yield* getPost({ param: params.page_parameter })); }`,
	);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

// ─── Destructuring yield* lowering ───────────────────────────

test("lowers destructuring yield* into a boundary-compatible await", () => {
	const source = `const { title, body } = yield* getPost(id);`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`function* __SER___effect_destructure() { return (yield* getPost(id)); }`,
	);
	assert_string_includes(result.code, `const { title, body } = await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [getPost, id]`);
	assert_not_match(result.code, /\$state<.*undefined/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

// ─── $derived(yield* expr) lowering ──────────────────────────

test("preserves $derived(yield* expr) as an async derived", () => {
	const source = `let msg = $derived(yield* format(user) + "!");`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`function* __SER___effect_msg() { return (yield* format(user)); }`,
	);
	assert_string_includes(result.code, `let msg = $derived(await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [format, user]`);
	assert_string_includes(result.code, `+ "!"`);
	assert_not_match(result.code, /\$state<.*undefined/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

// ─── $inspect lowering ───────────────────────────────────────

test("rejects $inspect(yield* expr) because inspect is dev-only", () => {
	const source = `$inspect(yield* debugInfo());`;

	assert_rejects_rune_yield(source, "$inspect");
});

// ─── Assignment expressions with yield* ──────────────────────

test("moves count = yield* expr into the effect body", () => {
	const source = [`let count = $state(0);`, `count = yield* getCount();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `let count = $state(0);`);
	assert_string_includes(result.code, `count = yield* getCount();`);
	assert_not_match(result.code, /count = __SER___/);
});

test("does not track assignment targets as reactive dependencies", () => {
	const source = [`let count = $state(0);`, `count = yield* Effect.succeed(count + 1);`].join(
		"\n",
	);
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `count = yield* Effect.succeed(count + 1);`);
	assert_string_includes(result.code, `  Effect;`);
	assert_not_match(result.code, /\n\s*count;\n/);
	assert_not_match(result.code, /void \[/);
});

test("preserves surrounding assignment RHS expressions", () => {
	const source = [`let value = $state(0);`, `value = (yield* loadValue()) + 1;`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `let __SER___value = $state<`);
	assert_string_includes(result.code, `__SER___value = yield* loadValue();`);
	assert_string_includes(result.code, `value = (__SER___value) + 1;`);
	assert_not_match(result.code, /^\s{4}value = yield\* loadValue\(\);$/m);
});

test("runs compound assignments after yielded operands resolve", () => {
	const source = [`let count = $state(0);`, `count += yield* getDelta();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `let __SER___count = $state<`);
	assert_string_includes(result.code, `__SER___count = yield* getDelta();`);
	assert_string_includes(result.code, `count += __SER___count;`);
	assert_not_match(result.code, /count \+= __SER___count;\n\n\$effect/);
});

test("runs ordinary call statements after yielded arguments resolve", () => {
	const source = `recordValue(yield* loadValue());`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `let __SER___call = $state<`);
	assert_string_includes(result.code, `__SER___call = yield* loadValue();`);
	assert_string_includes(result.code, `recordValue(__SER___call);`);
	assert_not_match(result.code, /^recordValue\(__SER___call\);/m);
});

// ─── Bare yield* statement (fire and forget) ─────────────────

test("moves bare yield* statements into the effect body", () => {
	const source = `yield* logView(userId);`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `yield* logView(userId);`);
	assert_string_includes(result.code, `Effect.gen(function*`);
});

// ─── NOT lowered (function boundary) ─────────────────────────

test("rejects yield* inside a $effect arrow function", () => {
	const source = `$effect(() => { yield* doThing(); });`;

	assert_rejects_rune_yield(source, "$effect");
});

test("does NOT lower yield* in Effect.gen inside a const declaration", () => {
	const source = `const program = Effect.gen(function* () { yield* foo(); });`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`const program = Effect.gen(function* () { yield* foo(); });`,
	);
	assert_not_match(result.code, /__SER__/);
});

// ─── Multiple yield* in one file ─────────────────────────────

test("handles multiple yield* expressions in one script", () => {
	const source = [
		`let a = $state(yield* f1());`,
		`const b = yield* f2();`,
		`yield* log("done");`,
	].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	const gen_count = (result.code.match(/Effect\.gen\(function\*/g) ?? []).length;
	const effect_count = (result.code.match(/\$effect\(\(\) =>/g) ?? []).length;
	if (gen_count !== 1) {
		throw new Error(`Expected 1 Effect.gen, got ${gen_count}`);
	}
	if (effect_count !== 1) {
		throw new Error(`Expected 1 $effect, got ${effect_count}`);
	}
});

// ─── Import handling ─────────────────────────────────────────

test("injects Effect import when not already present", () => {
	const source = `yield* f();`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `import { Effect } from "effect"`);
});

test("reuses existing Effect import when already present", () => {
	const source = [`import { Effect, Schema } from "effect";`, `yield* f();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");
	const import_count = [...result.code.matchAll(/import.*Effect.*from.*"effect"/g)].length;
	if (import_count !== 1) {
		throw new Error(`Expected 1 Effect import, got ${import_count}`);
	}
});

test("supports Effect import aliases in yielded expressions", () => {
	const source = [
		`import { Effect as E } from "effect";`,
		`let x = $state(yield* E.succeed(42));`,
	].join("\n");

	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `import { Effect as E } from "effect";`);
	assert_not_match(result.code, /import\s+\{\s*Effect\s*\}\s+from\s+"effect"/);
	assert_string_includes(result.code, `yield* E.succeed(42)`);
	assert_string_includes(result.code, `get_dispatcher().promise`);
});

test("injects Effect when effect module import lacks Effect binding", () => {
	const source = [`import { pipe } from "effect";`, `yield* f();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `import { pipe } from "effect";`);
	assert_string_includes(result.code, `import { Effect } from "effect";`);
	assert_string_includes(result.code, `Effect.gen(function* () {`);
});

test("type-only Effect import still injects a runtime Effect binding", () => {
	const source = [`import type { Effect } from "effect";`, `yield* loadValue();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `import type { Effect } from "effect";`);
	assert_string_includes(result.code, `import { Effect as __SER___Effect } from "effect";`);
	assert_string_includes(result.code, `__SER___Effect.gen(function* () {`);
});

test("local Effect binding does not collide with runtime Effect import", () => {
	const source = [`import { Effect } from "./local-effect";`, `yield* loadValue();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `import { Effect } from "./local-effect";`);
	assert_string_includes(result.code, `import { Effect as __SER___Effect } from "effect";`);
	assert_string_includes(result.code, `__SER___Effect.gen(function* () {`);
});

test("does not inject onMount for dependency-tracked runtime block", () => {
	const source = [`import { tick } from "svelte";`, `yield* f();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `import { tick } from "svelte";`);
	assert_not_match(result.code, /import \{ onMount \} from "svelte";/);
	assert_string_includes(result.code, `$effect(() => {`);
});

test("injects untrack when svelte import lacks untrack binding", () => {
	const source = [`import { tick } from "svelte";`, `yield* f();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `import { tick } from "svelte";`);
	assert_string_includes(result.code, `import { untrack } from "svelte";`);
	assert_string_includes(result.code, `untrack(() =>`);
});

test("reuses existing untrack import when already present", () => {
	const source = [`import { tick, untrack } from "svelte";`, `yield* f();`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");
	const import_count = [...result.code.matchAll(/import.*untrack.*from.*"svelte"/g)].length;

	if (import_count !== 1) {
		throw new Error(`Expected 1 untrack import, got ${import_count}`);
	}
});

test("injects dispatcher when generators import lacks get_dispatcher binding", () => {
	const source = [
		`import { value } from "svelte-effect-runtime/internal/generators";`,
		`yield* f();`,
	].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`import { get_dispatcher } from "svelte-effect-runtime/internal/generators";`,
	);
	assert_string_includes(result.code, `get_dispatcher();`);
});

test("declaration awaits do not inject Effect or untrack imports", () => {
	const source = `let x = $state(yield* f());`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`import { get_dispatcher } from "svelte-effect-runtime/internal/generators";`,
	);
	assert_not_match(result.code, /import \{ Effect \} from "effect"/);
	assert_not_match(result.code, /import \{ untrack \} from "svelte"/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

// ─── Error cases ─────────────────────────────────────────────

test("passes through top-level await without yield*", () => {
	const source = `const x = await fetch("/api");`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_equals(result.code, source);
});

test("rejects await mixed with lowered Effect work", () => {
	const source = `record(await transform(yield* load()));`;

	const error = assert_throws(
		() => transform_script_effect(source, "Test.svelte"),
		Error,
		"await cannot be mixed with yield*",
	);

	assert_string_includes(error.message, "[AWAIT_IN_EFFECT_WORK]:");
});

test("rejects yield* in synchronous-only rune arguments", () => {
	const cases = [
		`const eager = $state.eager(yield* getEager());`,
		`const props = $props(yield* getProps());`,
		`const id = $props.id(yield* getId());`,
		`const host = $host(yield* getHost());`,
		`const pending = $effect.pending(yield* getPending());`,
		`const tracking = $effect.tracking(yield* getTracking());`,
		`$inspect(yield* getDebugInfo());`,
	];

	for (const source of cases) {
		assert_rejects_rune_yield(source);
	}
});

test("allows await-compatible rune arguments", () => {
	const cases = [
		`const snapshot = $state.snapshot(yield* getSnapshot());`,
		`let { value = $bindable(yield* getFallback()) } = $props();`,
	];

	for (const source of cases) {
		const result = transform_script_effect(source, "Test.svelte");

		assert_string_includes(result.code, `await get_dispatcher().promise({`);
		assert_not_match(result.code, /\$effect\(\(\) =>/);
		assert_not_match(result.code, /\$state<.*undefined/);
	}
});

test("rejects yield* inside synchronous rune callbacks", () => {
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

test("generates __SER___ prefix for temp bindings", () => {
	const source = `const user = yield* getUser(id);`;
	const result = transform_script_effect(source, "Test.svelte");
	assert_match(result.code, /__SER___/);
});

test("uses __SER___program for the generated Effect.gen program", () => {
	const source = `yield* f();`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_match(result.code, /__SER___program/);
});

// ─── Edge cases ──────────────────────────────────────────────

test("preserves surrounding expression syntax character-for-character", () => {
	const source = `let result = $derived(yield* compute(a, b) * 2 + 1);`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `* 2 + 1`);
	assert_string_includes(result.code, `let result = $derived(await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [compute, a, b]`);
	assert_not_match(result.code, /\$derived\(__SER___/);
});

test("extracts every yield* expression in a compound initializer", () => {
	const source = `let result = $derived((yield* first()) + (yield* second()));`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `yield* first()`);
	assert_string_includes(result.code, `yield* second()`);
	assert_string_includes(result.code, `deps: [first]`);
	assert_string_includes(result.code, `deps: [second]`);
	assert_not_match(result.code, /\$derived\(\(__SER___\w+\) \+ \(__SER___\w+\)\)/);
	assert_match(result.code, /\$derived\(\(await get_dispatcher\(\)\.promise/);
});

test("plain compound declarations become boundary-compatible awaits", () => {
	const source = `const value = (yield* loadValue()) + 1;`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `const value = (await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [loadValue]`);
	assert_string_includes(result.code, `+ 1`);
	assert_not_match(result.code, /\$derived\(/);
	assert_not_match(result.code, /\$state<.*undefined/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

test("destructuring defaults with yield become boundary-compatible awaits", () => {
	const source = [
		`const post = { title: undefined };`,
		`const { title = yield* getTitle() } = post;`,
	].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `const post = { title: undefined };`);
	assert_string_includes(result.code, `const { title = await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [getTitle]`);
	assert_not_match(result.code, /\$state<.*undefined/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

test("props destructuring defaults with yield become boundary-compatible awaits", () => {
	const source = `let { value = yield* load() } = $props();`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `let { value = await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [load]`);
	assert_string_includes(result.code, `} = $props();`);
	assert_not_match(result.code, /\$state<.*undefined/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

test("rejects yield inside class fields", () => {
	const source = [`class Model {`, `  value = yield* loadValue();`, `}`].join("\n");

	const error = assert_throws(
		() => transform_script_effect(source, "Test.svelte"),
		Error,
		"yield* cannot be used inside class members",
	);

	assert_string_includes(error.message, "[ASYNC_EFFECT_IN_CLASS_MEMBER]:");
});

test("handles ternary with yield* in condition position", () => {
	const source = `let flag = $state(yield* check() ? "a" : "b");`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `? "a" : "b"`);
	assert_string_includes(result.code, `let flag = $state(await get_dispatcher().promise({`);
	assert_string_includes(result.code, `deps: [check]`);
	assert_not_match(result.code, /\$state<.*undefined/);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
});

test("does not choke on $props() or $bindable declarations", () => {
	const source = [`let { name, age } = $props();`, `let value = $bindable(0);`].join("\n");
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `$props()`);
	assert_string_includes(result.code, `$bindable(0)`);
	assert_not_match(result.code, /__SER__/);
});
