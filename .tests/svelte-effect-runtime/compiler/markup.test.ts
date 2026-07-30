import { transform_markup_effect } from "../../../modules/svelte-effect-runtime/src/markup/transform.ts";
import { scan_svelte_effect_source } from "../../../modules/svelte-effect-runtime/src/compiler/source-scan.ts";
import { create_relocations } from "../../../modules/svelte-effect-runtime/src/markup/transform/apply.ts";
import { sanitize_markup } from "../../../modules/svelte-effect-runtime/src/markup/transform/scan.ts";
import { reset_dispatcher } from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import {
	assert_equals,
	assert_false,
	assert_throws,
	assert_string_includes,
} from "../unit/helpers/assert.ts";
import { promise } from "../../../modules/svelte-effect-runtime/src/markup/promise.ts";
import { value } from "../../../modules/svelte-effect-runtime/src/markup/value.ts";
import { run } from "../../../modules/svelte-effect-runtime/src/markup/run.ts";
import { type AST, compile, parse, preprocess } from "svelte/compiler";
import { Effect } from "effect";
import { test } from "vitest";

type DocumentHost = typeof globalThis & { document?: unknown };

async function with_browser_document<A>(run_test: () => A | Promise<A>): Promise<A> {
	const global = globalThis as DocumentHost;
	const had_document = "document" in global;
	const previous_document = global.document;

	Object.defineProperty(global, "document", {
		configurable: true,
		value: {},
	});

	try {
		const result = await run_test();

		return result;
	} finally {
		if (had_document) {
			Object.defineProperty(global, "document", {
				configurable: true,
				value: previous_document,
			});
		} else {
			Reflect.deleteProperty(global, "document");
		}
	}
}

function assert_rejects_markup_rune_yield(source: string, rune_name: string): void {
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(error.message, "[ASYNC_EFFECT_IN_SYNC_RUNE]:");
	assert_string_includes(error.message, rune_name);
}

test("passes through markup with no yield* unchanged", () => {
	const source = `<h1>Hello</h1><p>World</p>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `<h1>Hello</h1>`);
	assert_string_includes(result.code, `<p>World</p>`);
	if (result.has_yield) throw new Error("has_yield should be false");
});

test("skips excluded block braces without per-brace tag scans", () => {
	const original_match_all = String.prototype.matchAll;
	let match_all_calls = 0;

	Object.defineProperty(String.prototype, "matchAll", {
		configurable: true,
		value(pattern: string | RegExp) {
			match_all_calls += 1;

			return original_match_all.call(this, pattern);
		},
	});

	try {
		const script_body = Array.from(
			{ length: 200 },
			(_, index) => `if (flag${index}) { value += ${index}; }`,
		).join("\n");
		const style_body = Array.from(
			{ length: 200 },
			(_, index) => `.item-${index} { color: red; }`,
		).join("\n");
		const source = [
			`<script>`,
			`  const ignored = yield* loadIgnored();`,
			script_body,
			`</script>`,
			`<style>`,
			style_body,
			`</style>`,
			`<!-- {yield* ignoredComment()} -->`,
			`<p>{yield* shown()}</p>`,
		].join("\n");

		const scan = scan_svelte_effect_source(source, "Excluded.svelte");
		const result = sanitize_markup(scan);

		assert_equals(result.candidates.length, 1);
		assert_string_includes(result.parse_code, `__SER___markup_placeholder_0`);
	} finally {
		Object.defineProperty(String.prototype, "matchAll", {
			configurable: true,
			value: original_match_all,
		});
	}

	if (match_all_calls > 8) {
		throw new Error(`expected precomputed excluded ranges, got ${match_all_calls} scans`);
	}
});

test("passes through markup with yield* inside a generator (function boundary)", () => {
	const source = `<span>{Effect.gen(function* () { yield* foo(); })}</span>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `yield*`);
	if (result.has_yield) throw new Error("has_yield should be false");
});

test("fast-path returns identity for files with no yield* text", () => {
	const source = `<h1>Nothing here</h1>`;
	const result = transform_markup_effect(source, "Test.svelte");

	if (result.code !== source) throw new Error("expected identity output");
	if (result.has_yield) throw new Error("has_yield should be false");
});

test("returns identity when yield* appears only inside a script", () => {
	const source = `<script effect>const value = yield* loadValue();</script><p>static</p>`;
	const result = transform_markup_effect(source, "ScriptOnly.svelte");

	assert_equals(result.code, source);
	assert_equals(result.has_yield, false);
});

test("rewrites {yield* expr} as async promise expression", () => {
	const source = `<span>{yield* renderDate()}</span>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `renderDate()`);
	assert_string_includes(result.code, `function* __SER___markup_effect`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("does not confuse helper import text in comments with a real import", () => {
	const fake_import = `import { Dispatcher, Code, ToEffect } from "svelte-effect-runtime/internal/generators";`;
	const source = `<!-- ${fake_import} --><span>{yield* renderDate()}</span>`;
	const result = transform_markup_effect(source, "CommentedImport.svelte");

	assert_string_includes(
		result.code,
		`import { Dispatcher, Code, ToEffect, ComponentScopeRef, get_dispatcher } from "svelte-effect-runtime/internal/generators";\nfunction*`,
	);

	compile(result.code, {
		filename: "CommentedImport.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites {yield* expr} with free identifier deps", () => {
	const source = `<span>{yield* format(user)}</span>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `format`);
	assert_string_includes(result.code, `user`);
	assert_string_includes(result.code, `[format, user]`);
});

test("rewrites yielded markup expressions using Effect import aliases", () => {
	const source = [
		`<script>import { Effect as E } from "effect";</script>`,
		`<span>{yield* E.succeed(42)}</span>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `yield* ToEffect(E.succeed(42))`);
	assert_string_includes(result.code, `import { Effect as E } from "effect";`);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites {#if yield* expr} in condition", () => {
	const source = `{#if yield* hasAccess()}<p>yes</p>{/if}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `hasAccess`);
	assert_string_includes(result.code, `{#if`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites {:else if yield* expr} in alternate condition", () => {
	const source = `{#if a}{:else if yield* checkFlag()}<p>flag</p>{/if}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `checkFlag`);
	assert_string_includes(result.code, `:else if`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites {#each yield* expr as item} in list", () => {
	const source = `{#each yield* getItems() as item}<li>{item}</li>{/each}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `getItems`);
	assert_string_includes(result.code, `{#each`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites {#await yield* expr} as promise() call", () => {
	const source = `{#await yield* loadData()}<p>loading</p>{:then val}<p>{val}</p>{/await}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `Code.Markup.Promise`);
	assert_string_includes(result.code, `loadData`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites {#await yield* expr} with :catch clause", () => {
	const source = `{#await yield* fetchUser()}<p>loading</p>{:then u}<p>{u.name}</p>{:catch err}<p>Error: {err.message}</p>{/await}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `Code.Markup.Promise`);
	assert_string_includes(result.code, `fetchUser`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites {@render yield* fn()} as cached optional snippet call", () => {
	const source = `{@render yield* getSnippet()}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `(`);
	assert_string_includes(result.code, `)()`);
	if (!result.has_yield) throw new Error("has_yield should be true");

	compile(result.code, {
		generate: "client",
		experimental: { async: true },
	});
	compile(result.code, {
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites yield inside render tag arguments without double-calling snippet output", () => {
	const source = [
		`<script>let { load } = $props();</script>`,
		`{#snippet child(value)}<p>{value}</p>{/snippet}`,
		`{@render child(yield* load())}`,
	].join("");
	const result = transform_markup_effect(source, "RenderArg.svelte");

	assert_string_includes(
		result.code,
		`{@render child(await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `return (yield* ToEffect(load()));`);
	if (result.code.includes(`)()}`)) {
		throw new Error("render arguments must not double-call snippet output");
	}

	compile(result.code, {
		filename: "RenderArg.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites yield inside snippet block bodies", () => {
	const source = [
		`<script>let { load } = $props();</script>`,
		`{#snippet child()}`,
		`<p>{yield* load()}</p>`,
		`{/snippet}`,
		`{@render child()}`,
	].join("");
	const result = transform_markup_effect(source, "SnippetBody.svelte");

	assert_string_includes(result.code, `Code.Markup.Promise`);
	assert_string_includes(result.code, `return (yield* ToEffect(load()));`);

	compile(result.code, {
		filename: "SnippetBody.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("preserves TypeScript mode while classifying typed snippets", () => {
	const source = [
		`<script lang="ts">let { load } = $props();</script>`,
		`{#snippet child(value: string)}<p>{value}</p>{/snippet}`,
		`{@render child(yield* load())}`,
	].join("");
	const result = transform_markup_effect(source, "TypedSnippet.svelte");

	assert_string_includes(result.code, `return (yield* ToEffect(load()));`);

	compile(result.code, {
		filename: "TypedSnippet.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites yield in dynamic svelte element tags", () => {
	const source = `<svelte:element this={yield* tag()}>Dynamic</svelte:element>`;
	const result = transform_markup_effect(source, "DynamicElement.svelte");

	assert_string_includes(
		result.code,
		`this={await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit`,
	);
	assert_string_includes(result.code, `return (yield* ToEffect(tag()));`);

	compile(result.code, {
		filename: "DynamicElement.svelte",
		generate: "client",
		experimental: { async: true },
	});
});

test("rewrites {@const x = yield* expr} in const initializer", () => {
	const source = `{@const x = yield* compute()}{x}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `compute`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites {const x = yield* expr} in declaration initializer", () => {
	const source = `{const x = yield* compute()}{x}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`{const x = await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `compute`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites {let x = yield* expr} in declaration initializer", () => {
	const source = `{let x = yield* compute()}{x}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`{let x = await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `compute`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("preserves declaration rune placement while lowering yield*", () => {
	const source = [
		`<script>`,
		`  function getPublicationRemote() {}`,
		`  const params = { publication_id: "p1" };`,
		`</script>`,
		`{let publication = $derived(yield* getPublicationRemote({ publicationId: params.publication_id }))}`,
		`<p>{publication}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`$derived(await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);

	if (result.code.includes("[$derived")) {
		throw new Error("runes must not be captured as runtime dependencies");
	}

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("client declaration tags lower to awaited promise reads", () => {
	const source = [
		`<script>`,
		`  function getPublicationRemote() {}`,
		`  const params = { publication_id: "p1" };`,
		`</script>`,
		`{let publication = $derived(yield* getPublicationRemote({ publicationId: params.publication_id }))}`,
		`<p>{publication}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "Publication.svelte", {
		target: "client",
	});

	assert_string_includes(
		result.code,
		`$derived(await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);

	if (result.code.includes(`Code.Markup.Value`)) {
		throw new Error("client declaration tags must not emit value reads");
	}

	compile(result.code, {
		filename: "Publication.svelte",
		generate: "client",
		experimental: { async: true },
	});
});

test("editor declaration tags lower to awaited promise reads", () => {
	const source = [
		`<script>`,
		`  function getPublicationRemote() {}`,
		`  const params = { publication_id: "p1" };`,
		`</script>`,
		`{let publication = $derived(yield* getPublicationRemote({ publicationId: params.publication_id }))}`,
		`<p>{publication}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "Publication.svelte", {
		target: "editor",
	});

	assert_string_includes(
		result.code,
		`$derived(await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);

	if (result.code.includes(`Code.Markup.Value`)) {
		throw new Error("editor declaration tags must not emit value reads");
	}

	compile(result.code, {
		filename: "Publication.svelte",
		generate: "client",
		experimental: { async: true },
	});
});

test("server declaration tags lower to awaited promise reads", () => {
	const source = [
		`<script>`,
		`  function getPublicationRemote() {}`,
		`  const params = { publication_id: "p1" };`,
		`</script>`,
		`{let publication = $derived(yield* getPublicationRemote({ publicationId: params.publication_id }))}`,
		`<p>{publication}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "Publication.svelte", {
		target: "server",
	});

	assert_string_includes(
		result.code,
		`$derived(await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);

	compile(result.code, {
		filename: "Publication.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("client render tags use awaited promise calls", () => {
	const source = `{@render yield* getSnippet()}`;
	const result = transform_markup_effect(source, "RenderClient.svelte", {
		target: "client",
	});

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit`,
	);
	assert_string_includes(result.code, `Code.Markup.Promise`);
	assert_string_includes(result.code, `)()`);

	compile(result.code, {
		filename: "RenderClient.svelte",
		generate: "client",
		experimental: { async: true },
	});
});

test("server render tags use noop snippet fallback during SSR", () => {
	const source = `{@render yield* getSnippet()}`;
	const result = transform_markup_effect(source, "RenderServer.svelte", {
		target: "server",
	});

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit`,
	);
	assert_string_includes(result.code, `ssr_fallback: () => undefined`);
	assert_string_includes(result.code, `)()`);

	compile(result.code, {
		filename: "RenderServer.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("client common markup contexts compile with async option", () => {
	const source = [
		`<script>`,
		`  function hasAccess() {}`,
		`  function getItems() {}`,
		`  function getLabel(item) {}`,
		`  function loadValue() {}`,
		`</script>`,
		`{#if yield* hasAccess()}<p>{yield* loadValue()}</p>{/if}`,
		`{#each yield* getItems() as item}`,
		`  <p>{yield* getLabel(item)}</p>`,
		`{/each}`,
		`{#key yield* loadValue()}<span>keyed</span>{/key}`,
		`{#snippet child(value)}<p>{value}</p>{/snippet}`,
		`{@render child(yield* loadValue())}`,
		`{const value = yield* loadValue()}<p>{value}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "ClientContexts.svelte", {
		target: "client",
	});

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);

	compile(result.code, {
		filename: "ClientContexts.svelte",
		generate: "client",
		experimental: { async: true },
	});
});

test("server common markup contexts compile with async option", () => {
	const source = [
		`<script>`,
		`  function hasAccess() {}`,
		`  function getItems() {}`,
		`  function getLabel(item) {}`,
		`  function loadValue() {}`,
		`</script>`,
		`{#if yield* hasAccess()}<p>{yield* loadValue()}</p>{/if}`,
		`{#each yield* getItems() as item}`,
		`  <p>{yield* getLabel(item)}</p>`,
		`{/each}`,
		`{#key yield* loadValue()}<span>keyed</span>{/key}`,
		`{#snippet child(value)}<p>{value}</p>{/snippet}`,
		`{@render child(yield* loadValue())}`,
		`{const value = yield* loadValue()}<p>{value}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "ServerContexts.svelte", {
		target: "server",
	});

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `ssr_fallback: undefined`);
	assert_string_includes(result.code, `ssr_fallback: []`);

	compile(result.code, {
		filename: "ServerContexts.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("lowers multiple yield* expressions inside declaration runes", () => {
	const source = [
		`<script>`,
		`  function first() {}`,
		`  function second() {}`,
		`</script>`,
		`{let value = $derived((yield* first()) + (yield* second()))}`,
		`<p>{value}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");
	const promise_calls = [...result.code.matchAll(/Code\.Markup\.Promise/g)].length;

	assert_equals(promise_calls, 2);
	assert_string_includes(
		result.code,
		`$derived((await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(
		result.code,
		`+ (await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites destructured declaration tag initializers", () => {
	const source = `{const { value } = yield* load()}{value}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`{const { value } = await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `load`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites destructured declaration tag defaults", () => {
	const source = [
		`<script>`,
		`  const data = {};`,
		`  function fallbackValue() {}`,
		`</script>`,
		`{let { value = yield* fallbackValue() } = data}`,
		`<p>{value}</p>`,
	].join("\n");
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`{let { value = await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `fallbackValue`);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites multiple declaration tag initializers", () => {
	const source = `{const a = yield* getA(), b = yield* getB()}{a}{b}`;
	const result = transform_markup_effect(source, "Test.svelte");

	const promise_calls = [...result.code.matchAll(/Code\.Markup\.Promise/g)].length;

	assert_equals(promise_calls, 2);
	assert_string_includes(result.code, `getA`);
	assert_string_includes(result.code, `getB`);
});

test("rejects yield* in synchronous-only markup declaration runes", () => {
	const cases: Array<[string, string]> = [
		[`{const value = $state.eager(yield* loadEager())}`, "$state.eager"],
		[`{const props = $props(yield* loadProps())}`, "$props"],
		[`{const id = $props.id(yield* loadId())}`, "$props.id"],
		[`{const pending = $effect.pending(yield* loadPending())}`, "$effect.pending"],
		[`{const tracking = $effect.tracking(yield* loadTracking())}`, "$effect.tracking"],
		[`{const host = $host(yield* loadHost())}`, "$host"],
		[`{const value = $inspect(yield* loadDebug())}`, "$inspect"],
		[`{const value = $derived.by(() => yield* compute())}`, "$derived.by"],
		[`{const value = $effect(() => yield* runEffect())}`, "$effect"],
	];

	for (const [source, rune_name] of cases) {
		assert_rejects_markup_rune_yield(source, rune_name);
	}
});

test("rejects yield* in synchronous-only markup const tag runes", () => {
	const source = `{#if ready}{@const value = $inspect(yield* loadDebug())}{/if}`;

	assert_rejects_markup_rune_yield(source, "$inspect");
});

test("rewrites {#key yield* expr} in key expression", () => {
	const source = `{#key yield* getKey()}<p>content</p>{/key}`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`await Dispatcher.with_scope(__SER___scope.scope, () => Dispatcher.emit({ type: Code.Markup.Promise`,
	);
	assert_string_includes(result.code, `getKey`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites onclick event effect expressions as run wrappers", () => {
	const source = `<button onclick={yield* trackEvent()}>click</button>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `onclick={(event) =>`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_string_includes(
		result.code,
		`Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* ToEffect(trackEvent()); } });`,
	);
	if (result.code.includes("void Code.Markup.Run")) {
		throw new Error("event handler wrappers should not emit void");
	}
	assert_string_includes(result.code, `trackEvent`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("rewrites event effect expressions with generated event parameter", () => {
	const source = `<input oninput={yield* validate(event.currentTarget.value)} />`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `oninput={(event) =>`);
	assert_string_includes(result.code, `event.currentTarget.value`);
	assert_string_includes(
		result.code,
		`Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* ToEffect(validate(event.currentTarget.value)); } });`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites onsubmit event effect expressions", () => {
	const source = `<form onsubmit={yield* submit()}></form>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `onsubmit={(event) =>`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_string_includes(result.code, `yield* ToEffect(submit())`);
});

test("rewrites event effect expressions inside snippet blocks", () => {
	const source = [
		`{#snippet row()}`,
		`  <input onchange={yield* Effect.gen(function* () {})} />`,
		`{/snippet}`,
		`{@render row()}`,
	].join("\n");

	const result = transform_markup_effect(source, "Creation.svelte");

	assert_string_includes(result.code, `onchange={(event) =>`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_string_includes(result.code, `yield* ToEffect(Effect.gen(function* () {}))`);

	compile(result.code, {
		filename: "Creation.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites mixed-case DOM event effect attributes as lowercase handlers", () => {
	const source = `<input onChange={yield* validate(event)} />`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `onchange={(event) =>`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_string_includes(result.code, `yield* ToEffect(validate(event))`);

	const compiled = compile(result.code, {
		filename: "Test.svelte",
		generate: "client",
		experimental: { async: true },
	});

	assert_string_includes(compiled.js.code, `change`);
	if (compiled.js.code.includes(`Change`)) {
		throw new Error("DOM event names should compile as lowercase events");
	}
});

test("rewrites on:click event effect expressions", () => {
	const source = `<button on:click={yield* save(event)}>save</button>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `on:click={(event) =>`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_string_includes(result.code, `yield* ToEffect(save(event))`);
});

test("rewrites mixed-case legacy DOM event directives as lowercase handlers", () => {
	const source = `<button on:Click={yield* save(event)}>save</button>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `on:click={(event) =>`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_string_includes(result.code, `yield* ToEffect(save(event))`);
});

test("rewrites custom event-like handler attributes", () => {
	const source = `<button oncustom={yield* handle(event)}>save</button>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `oncustom={(event) =>`);
	assert_string_includes(result.code, `yield* ToEffect(handle(event))`);
});

test("rejects mixed-value attributes that Svelte does not classify as events", () => {
	const source = `<button onclick="prefix-{yield* handle(event)}">save</button>`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(error.message, "[UNSUPPORTED_MARKUP_EFFECT_POSITION]:");
	assert_string_includes(error.message, `yield* handle(event)`);
});

test("rewrites quoted single-expression attributes that Svelte classifies as events", () => {
	const source = `<button onclick="{yield* handle(event)}">save</button>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `onclick="{(event) =>`);
	assert_string_includes(result.code, `yield* ToEffect(handle(event))`);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("matches Svelte event attribute classification for hyphenated names", () => {
	const source = `<button on-custom={yield* handle(event)}>save</button>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `on-custom={(event) =>`);
	assert_string_includes(result.code, `yield* ToEffect(handle(event))`);
});

test("rejects uppercase names that Svelte does not classify as events", () => {
	const source = `<button ONCLICK={yield* handle(event)}>save</button>`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(error.message, "[UNSUPPORTED_MARKUP_EFFECT_POSITION]:");
	assert_string_includes(error.message, `yield* handle(event)`);
});

test("rewrites native-style form validation handlers only when marked with yield*", () => {
	const source = `<form {...createPost} oninput={yield* createPost.validate()}></form>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `oninput={(event) =>`);
	assert_string_includes(
		result.code,
		`Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* ToEffect(createPost.validate()); } });`,
	);
	assert_string_includes(result.code, `from "svelte-effect-runtime/internal/generators"`);
	if (!result.has_yield) throw new Error("has_yield should be true");
});

test("injects dispatcher import when another generated helper import already exists", () => {
	const source = [
		`<script>`,
		`  import { value as __ser_markup_value } from "svelte-effect-runtime/internal/generators";`,
		`  import { Effect } from "effect";`,
		`</script>`,
		`<input oninput={yield* Effect.gen(function* () {`,
		`  const file = event.currentTarget.files?.[0];`,
		`  if (!file) return;`,
		`  console.log(file);`,
		`})} />`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");
	const value_imports = [...result.code.matchAll(/\bvalue as __ser_markup_value\b/g)].length;

	assert_equals(value_imports, 1);
	assert_string_includes(
		result.code,
		`import { Dispatcher, Code, ToEffect, ComponentScopeRef, get_dispatcher } from "svelte-effect-runtime/internal/generators";`,
	);
	assert_string_includes(
		result.code,
		`Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* ToEffect(Effect.gen(function* () {`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "client",
		experimental: { async: true },
	});
});

test("leaves non-Effect event handlers untouched", () => {
	const source = `<form {...formSnap} oninput={() => formSnap.validate()}></form>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_equals(result.code, source);
	if (result.has_yield) throw new Error("has_yield should be false");
});

test("rejects yield* inside event callback handlers", () => {
	const source = `<button onclick={() => yield* save()}>save</button>`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(
		error.message,
		"yield* in markup event handlers must be written directly",
	);
	assert_string_includes(error.message, `onclick={yield* UpvotePost(id)}`);
	assert_string_includes(error.message, `onclick={() => yield* UpvotePost(id)}`);
});

test("rejects event callback handlers with parameters", () => {
	const source = `<input oninput={(event) => yield* validate(event)} />`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(
		error.message,
		"yield* in markup event handlers must be written directly",
	);
});

test("rejects legacy on directive callback handlers", () => {
	const source = `<button on:click={() => yield* save()}>save</button>`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(
		error.message,
		"yield* in markup event handlers must be written directly",
	);
});

test("rejects function expression event callbacks", () => {
	const source = `<button onclick={function () { yield* save(); }}>save</button>`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(
		error.message,
		"yield* in markup event handlers must be written directly",
	);
});

test("allows direct explicit Effect.gen event composition", () => {
	const source = `<button onclick={yield* Effect.gen(function* () { yield* save(); })}>save</button>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `onclick={(event) =>`);
	assert_string_includes(
		result.code,
		`yield* ToEffect(Effect.gen(function* () { yield* save(); }))`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites nested yield* in Effect.matchCause event handlers", () => {
	const source = [
		`<button onclick={yield* savePost().pipe(Effect.matchCause({`,
		`  onSuccess: (result) => { return yield* notify(result); },`,
		`  onFailure: (cause) => "failed"`,
		`}))}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `Effect.matchCauseEffect`);
	assert_string_includes(
		result.code,
		`onSuccess: (result) => Effect.gen(function* () { return yield* notify(result); })`,
	);
	assert_string_includes(result.code, `onFailure: (cause) => Effect.sync(() => ("failed"))`);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("preserves plain matchCause success callback values when upgrading", () => {
	const source = [
		`<button onclick={yield* savePost().pipe(Effect.matchCause({`,
		`  onSuccess: (result) => result.id,`,
		`  onFailure: (cause) => { return yield* recover(cause); }`,
		`}))}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `Effect.matchCauseEffect`);
	assert_string_includes(result.code, `onSuccess: (result) => Effect.sync(() => (result.id))`);

	if (result.code.includes(`onSuccess: (result) => true`)) {
		throw new Error("matchCauseEffect success callbacks must preserve values");
	}

	if (result.code.includes(`onSuccess: (result) => false`)) {
		throw new Error("matchCauseEffect success callbacks must preserve values");
	}

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("preserves function-expression match callback values when upgrading", () => {
	const source = [
		`<button onclick={yield* savePost().pipe(Effect.match({`,
		`  onSuccess: function (result) { return result.id; },`,
		`  onFailure: function (error) { return yield* recover(error); }`,
		`}))}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `Effect.matchEffect`);
	assert_string_includes(
		result.code,
		`onSuccess: function (result) { return Effect.sync(() => { return result.id; }); }`,
	);
	assert_string_includes(
		result.code,
		`onFailure: function (error) { return Effect.gen(function* () { return yield* recover(error); }); }`,
	);

	if (result.code.includes(`onSuccess: function (result) { return true; }`)) {
		throw new Error("matchEffect success callbacks must preserve values");
	}

	if (result.code.includes(`onSuccess: function (result) { return false; }`)) {
		throw new Error("matchEffect success callbacks must preserve values");
	}

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites nested yield* inside explicit Effect.gen event handlers", () => {
	const source = [
		`<button onclick={yield* Effect.gen(function* () {`,
		`  yield* savePost().pipe(Effect.matchCause({`,
		`    onSuccess: (result) => { return yield* notify(result); },`,
		`    onFailure: (cause) => "failed"`,
		`  }));`,
		`})}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `Effect.matchCauseEffect`);
	assert_string_includes(
		result.code,
		`onSuccess: (result) => Effect.gen(function* () { return yield* notify(result); })`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites nested yield* in effect-returning event callbacks", () => {
	const source = [
		`<button onclick={yield* loadPost().pipe(`,
		`  Effect.flatMap((post) => { return yield* notify(post); })`,
		`)}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`Effect.flatMap((post) => Effect.gen(function* () { return yield* notify(post); }))`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites nested yield* through aliased Effect imports", () => {
	const source = [
		`<script>import { Effect as E } from "effect";</script>`,
		`<button onclick={yield* savePost().pipe(E.matchCause({`,
		`  onSuccess: (result) => { return yield* notify(result); },`,
		`  onFailure: (cause) => "failed"`,
		`}))}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `E.matchCauseEffect`);
	assert_string_includes(
		result.code,
		`onSuccess: (result) => E.gen(function* () { return yield* notify(result); })`,
	);
	assert_string_includes(result.code, `onFailure: (cause) => E.sync(() => ("failed"))`);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites nested yield* through effect module namespaces", () => {
	const source = [
		`<script>import * as E from "effect/Effect";</script>`,
		`<button onclick={yield* loadPost().pipe(`,
		`  E.flatMap((post) => { return yield* notify(post); })`,
		`)}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`E.flatMap((post) => E.gen(function* () { return yield* notify(post); }))`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites nested yield* through effect package namespaces", () => {
	const source = [
		`<script>import * as Fx from "effect";</script>`,
		`<button onclick={yield* savePost().pipe(Fx.Effect.match({`,
		`  onSuccess: (result) => { return yield* notify(result); },`,
		`  onFailure: () => "failed"`,
		`}))}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `Fx.Effect.matchEffect`);
	assert_string_includes(
		result.code,
		`onSuccess: (result) => Fx.Effect.gen(function* () { return yield* notify(result); })`,
	);
	assert_string_includes(result.code, `onFailure: () => Fx.Effect.sync(() => ("failed"))`);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites nested yield* through direct effect function imports", () => {
	const source = [
		`<script>`,
		`  import { matchCause as mc } from "effect/Effect";`,
		`  const Effect = {};`,
		`</script>`,
		`<button onclick={yield* savePost().pipe(mc({`,
		`  onSuccess: (result) => { return yield* notify(result); },`,
		`  onFailure: () => "failed"`,
		`}))}>save</button>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `import { Effect as __SER___Effect } from "effect";`);
	assert_string_includes(result.code, `__SER___Effect.matchCauseEffect`);
	assert_string_includes(
		result.code,
		`onSuccess: (result) => __SER___Effect.gen(function* () { return yield* notify(result); })`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("rewrites nested yield* in non-event markup expressions", () => {
	const source = [
		`<script>import { Effect as E } from "effect";</script>`,
		`<p>{yield* loadPost().pipe(`,
		`  E.flatMap((post) => { return yield* renderPost(post); })`,
		`)}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(
		result.code,
		`E.flatMap((post) => E.gen(function* () { return yield* renderPost(post); }))`,
	);

	compile(result.code, {
		filename: "Test.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("tracks free identifiers inside nested generator expressions", () => {
	const source = `<p>{yield* Effect.gen(function* () { return yield* load(user); })}</p>`;
	const result = transform_markup_effect(source, "Deps.svelte");

	assert_string_includes(result.code, `[Effect, load, user]`);
	assert_string_includes(result.code, `function* __SER___markup_effect`);
});

test("rejects unrelated matchCause receivers with nested yield*", () => {
	const source = [
		`<button onclick={yield* savePost().pipe(foo.matchCause({`,
		`  onSuccess: (result) => { return yield* notify(result); },`,
		`  onFailure: () => "failed"`,
		`}))}>save</button>`,
	].join("\n");
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(error.message, "[ASYNC_EFFECT_IN_EVENT_CALLBACK]:");
	assert_string_includes(
		error.message,
		"yield* cannot be used inside a nested non-generator callback",
	);
});

test("rejects callbacks hiding yield* inside nested generators", () => {
	const source = `<button onclick={() => Effect.gen(function* () { yield* save(); })}>save</button>`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(
		error.message,
		"yield* in markup event handlers must be written directly",
	);
});

test("rejects yield* inside nested non-generator event callbacks", () => {
	const source = `<button onclick={yield* Effect.try(() => yield* save())}>save</button>`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(error.message, "[ASYNC_EFFECT_IN_EVENT_CALLBACK]:");
	assert_string_includes(
		error.message,
		"yield* cannot be used inside a nested non-generator callback",
	);
	assert_string_includes(error.message, `onclick={yield* UpvotePost(id)}`);
	assert_string_includes(
		error.message,
		`Effect.try and Effect.sync callbacks are plain synchronous JavaScript`,
	);
	assert_string_includes(
		error.message,
		`onclick={yield* UpvotePost(id).pipe(Effect.catch(() => Effect.void))}`,
	);
});

test("rejects nested callback yield* even with an outer yield*", () => {
	const source = `<button onclick={yield* Effect.try(() => yield* save())}>save</button>`;
	const error = assert_throws(() => transform_markup_effect(source, "Test.svelte"));

	assert_string_includes(error.message, "[ASYNC_EFFECT_IN_EVENT_CALLBACK]:");
	assert_string_includes(
		error.message,
		"yield* cannot be used inside a nested non-generator callback",
	);
});

test("handles multiple yield* expressions in markup", () => {
	const source = [`<p>{yield* getA()}</p>`, `<p>{yield* getB()}</p>`].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	/** Count actual helper call sites (not import aliases). */
	const promise_calls = [...result.code.matchAll(/Code\.Markup\.Promise/g)].length;
	if (promise_calls !== 2) {
		throw new Error(`expected 2 promise calls, got ${promise_calls}`);
	}
});

test("records source relocations for lowered markup hover spans", () => {
	const source = [
		`<script lang="ts" effect>`,
		`  import { GetPosts, UpvotePost } from "./posts.remote";`,
		`</script>`,
		``,
		`<ul>`,
		`  {#each yield* GetPosts() as { id, name, likes }}`,
		`    <li>`,
		`      <button onclick={yield* UpvotePost(id)}>{name}</button>`,
		`    </li>`,
		`  {/each}`,
		`</ul>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");
	const relocations = result.relocations ?? [];

	const each_original_start = source.indexOf("GetPosts()");
	const event_original_start = source.indexOf("UpvotePost(id)");

	const each_relocation = relocations.find(
		(relocation) => relocation.originalStart === each_original_start,
	);
	const event_relocation = relocations.find(
		(relocation) => relocation.originalStart === event_original_start,
	);

	if (!each_relocation) {
		throw new Error("expected relocation for each expression");
	}

	if (!event_relocation) {
		throw new Error("expected relocation for event handler expression");
	}

	assert_equals(
		source.slice(each_relocation.originalStart, each_relocation.originalEnd),
		"GetPosts()",
	);
	assert_equals(
		result.code.slice(each_relocation.generatedStart, each_relocation.generatedEnd),
		"GetPosts()",
	);
	assert_equals(
		source.slice(event_relocation.originalStart, event_relocation.originalEnd),
		"UpvotePost(id)",
	);
	assert_equals(
		result.code.slice(event_relocation.generatedStart, event_relocation.generatedEnd),
		"UpvotePost(id)",
	);
});

test("generates distinct markup cache ids for different files", () => {
	const first = transform_markup_effect(`<p>{yield* getUser()}</p>`, "User.svelte");

	const second = transform_markup_effect(`<p>{yield* getPost()}</p>`, "Post.svelte");

	const pattern = /id: ("[^"]+"),/;
	const first_id = first.code.match(pattern)?.[1];
	const second_id = second.code.match(pattern)?.[1];

	assert_equals(first_id === second_id, false);
});

test("injects helpers into the real instance script around structural lookalikes", () => {
	const source = [
		`<!-- <script>comment_script</script><style>comment_style</style> -->`,
		`<style>`,
		`  .sentinel::before { content: "<script>style_script</script>"; }`,
		`</style >`,
		`<div data-source="<script>attribute_script</script>">`,
		`  {\`<script>expression_script</script>\`}`,
		`</div>`,
		`<script lang="ts">`,
		`  const real_instance = "instance_sentinel";`,
		`</script>`,
		`<p>{yield* loadCombined()}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "StructuralLookalikes.svelte");
	const ast = parse(result.code, {
		filename: "StructuralLookalikes.svelte",
		modern: true,
	}) as AST.Root;

	if (!ast.instance) {
		throw new Error("expected the real instance script");
	}

	const instance_source = result.code.slice(ast.instance.content.start, ast.instance.content.end);

	assert_string_includes(instance_source, `const real_instance = "instance_sentinel";`);
	assert_string_includes(instance_source, `from "svelte-effect-runtime/internal/generators"`);
	assert_string_includes(
		result.code,
		`<!-- <script>comment_script</script><style>comment_style</style> -->`,
	);
	assert_string_includes(result.code, `content: "<script>style_script</script>"`);
	assert_string_includes(result.code, `data-source="<script>attribute_script</script>"`);
	assert_string_includes(result.code, `{\`<script>expression_script</script>\`}`);

	compile(result.code, {
		filename: "StructuralLookalikes.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("handles quoted generics while allocating occupied Effect and runtime names", () => {
	const source = [
		`<script lang="ts" generics="T extends { marker: '>' }">`,
		`  import { matchCause as mc } from "effect/Effect";`,
		`  const Effect = {};`,
		`  const __SER___Effect = {};`,
		`  const Dispatcher = {};`,
		`  const Code = {};`,
		`  const ToEffect = {};`,
		`</script>`,
		`<p>{yield* loadPost().pipe(mc({`,
		`  onSuccess: (post) => { return yield* renderPost(post); },`,
		`  onFailure: () => "failed"`,
		`}))}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "QuotedGenerics.svelte");

	assert_string_includes(result.code, `import { Effect as __SER___Effect_1 } from "effect";`);
	assert_string_includes(result.code, `Dispatcher as Dispatcher_1`);
	assert_string_includes(result.code, `Code as Code_1`);
	assert_string_includes(result.code, `ToEffect as ToEffect_1`);
	assert_string_includes(result.code, `__SER___Effect_1.matchCauseEffect`);
	assert_string_includes(result.code, `Dispatcher_1.emit`);
	assert_string_includes(result.code, `Code_1.Markup.Promise`);
	assert_string_includes(result.code, `yield* ToEffect_1(`);
	assert_equals([...result.code.matchAll(/<script\b/g)].length, 1);

	compile(result.code, {
		filename: "QuotedGenerics.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("allocates helper aliases against markup-scoped identifiers", () => {
	const source = `{#each [1] as Code}<p>{Code}: {yield* loadValue()}</p>{/each}`;
	const result = transform_markup_effect(source, "MarkupBindings.svelte");

	assert_string_includes(result.code, `Code as Code_1`);
	assert_string_includes(result.code, `Code_1.Markup.Promise`);
	assert_string_includes(result.code, `{#each [1] as Code}`);

	compile(result.code, {
		filename: "MarkupBindings.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("allocates helper aliases against brace-less let directives", () => {
	const source = [
		`<Component let:Code let:Dispatcher>`,
		`  <p>{yield* loadValue()}</p>`,
		`</Component>`,
	].join("\n");
	const result = transform_markup_effect(source, "LetBindings.svelte");

	assert_string_includes(result.code, `Code as Code_1`);
	assert_string_includes(result.code, `Dispatcher as Dispatcher_1`);
	assert_string_includes(result.code, `Code_1.Markup.Promise`);
	assert_string_includes(
		result.code,
		`await Dispatcher_1.with_scope(__SER___scope.scope, () => Dispatcher_1.emit`,
	);
	assert_string_includes(result.code, `<Component let:Code let:Dispatcher>`);

	compile(result.code, {
		filename: "LetBindings.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("allocates helper aliases against markup rest bindings", () => {
	const source = [
		`{#each rows as {...Code}}`,
		`  {#each rows as {...Dispatcher}}`,
		`    <p>{yield* loadValue()}</p>`,
		`  {/each}`,
		`{/each}`,
	].join("\n");
	const result = transform_markup_effect(source, "RestBindings.svelte");

	assert_string_includes(result.code, `Code as Code_1`);
	assert_string_includes(result.code, `Dispatcher as Dispatcher_1`);
	assert_string_includes(result.code, `Code_1.Markup.Promise`);
	assert_string_includes(
		result.code,
		`await Dispatcher_1.with_scope(__SER___scope.scope, () => Dispatcher_1.emit`,
	);

	compile(result.code, {
		filename: "RestBindings.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("allocates generated effect names against markup rest bindings", () => {
	const source = `{#each rows as {...__SER___markup_effect_52_65}}<p>{yield* load()}</p>{/each}`;
	const result = transform_markup_effect(source, "GeneratedRestBinding.svelte");

	assert_string_includes(result.code, `function* __SER___markup_effect_52_65_1()`);
	assert_string_includes(result.code, `__SER___markup_effect_52_65_1()`);
	assert_string_includes(result.code, `{#each rows as {...__SER___markup_effect_52_65}}`);

	compile(result.code, {
		filename: "GeneratedRestBinding.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("keeps generics containing a module property as the instance script", () => {
	const source = [
		`<script lang="ts" generics="T extends { module: string }">`,
		`  const instance_marker = "preserved";`,
		`</script>`,
		`<p>{yield* loadValue()}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "ModuleGeneric.svelte");
	const helper_index = result.code.indexOf(`from "svelte-effect-runtime/internal/generators"`);
	const script_end = result.code.indexOf(`</script>`);

	assert_equals([...result.code.matchAll(/<script\b/g)].length, 1);
	assert_string_includes(result.code, `generics="T extends { module: string }"`);
	assert_string_includes(result.code, `const instance_marker = "preserved";`);

	if (helper_index === -1 || helper_index > script_end) {
		throw new Error("expected helpers inside the existing instance script");
	}

	compile(result.code, {
		filename: "ModuleGeneric.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("preserves script offsets when markup yield appears before the instance script", () => {
	const source = [
		`<p>{yield* loadBeforeScript()}</p>`,
		`<script lang="ts">`,
		`  const after_markup = "preserved";`,
		`</script>`,
	].join("\n");

	const result = transform_markup_effect(source, "MarkupBeforeScript.svelte");
	const script_start = result.code.indexOf(`<script lang="ts">`);
	const helper_index = result.code.indexOf(`from "svelte-effect-runtime/internal/generators"`);
	const script_end = result.code.indexOf(`</script>`);
	const operand_start = source.indexOf("loadBeforeScript()");
	const operand_end = operand_start + "loadBeforeScript()".length;
	const operand_relocations = (result.relocations ?? []).filter(
		(relocation) =>
			relocation.originalStart === operand_start && relocation.originalEnd === operand_end,
	);

	assert_equals([...result.code.matchAll(/<script\b/g)].length, 1);
	assert_string_includes(result.code, `loadBeforeScript()`);
	assert_string_includes(result.code, `const after_markup = "preserved";`);

	if (script_start === -1 || helper_index < script_start || helper_index > script_end) {
		throw new Error("expected helpers at the original instance script offset");
	}

	if (operand_relocations.length === 0) {
		throw new Error("expected a relocation for the yielded operand");
	}

	for (const relocation of operand_relocations) {
		assert_equals(
			source.slice(relocation.originalStart, relocation.originalEnd),
			"loadBeforeScript()",
		);
		assert_equals(
			result.code.slice(relocation.generatedStart, relocation.generatedEnd),
			"loadBeforeScript()",
		);
	}

	if (!operand_relocations.some((relocation) => relocation.generatedStart > script_start)) {
		throw new Error("expected the operand relocation inside the instance script helper");
	}

	compile(result.code, {
		filename: "MarkupBeforeScript.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("maps a source-start operand after prepending the generated script", () => {
	const source = `{yield* load()}`;
	const result = transform_markup_effect(source, "SourceStart.svelte");
	const operand_start = source.indexOf("load()");
	const operand_end = operand_start + "load()".length;
	const relocations = (result.relocations ?? []).filter(
		(relocation) =>
			relocation.originalStart === operand_start && relocation.originalEnd === operand_end,
	);

	if (relocations.length === 0) {
		throw new Error("expected a relocation for the source-start operand");
	}

	for (const relocation of relocations) {
		assert_equals(
			result.code.slice(relocation.generatedStart, relocation.generatedEnd),
			"load()",
		);
	}
});

test("orders a helper before an equal-offset replacement relocation", () => {
	const helper_text = `<script>helper</script>\n`;
	const replacement_text = `before load() after`;
	const generated = helper_text + replacement_text;
	const relocations = create_relocations(
		[
			{
				start: 0,
				end: 15,
				text: replacement_text,
				relocation: {
					originalStart: 8,
					originalEnd: 14,
					generatedStartInReplacement: "before ".length,
					generatedEndInReplacement: "before load()".length,
				},
			},
		],
		{ start: 0, text: helper_text },
	);
	const relocation = relocations[0];

	if (!relocation) {
		throw new Error("expected the equal-offset replacement relocation");
	}

	assert_equals(generated.slice(relocation.generatedStart, relocation.generatedEnd), "load()");
});

test("creates many replacement relocations without rescanning prior edits", () => {
	const count = 20_000;
	const max_elapsed_ms = 2_000;
	const replacements = Array.from({ length: count }, (_, index) => ({
		start: index * 2,
		end: index * 2 + 1,
		text: "value",
		relocation: {
			originalStart: index * 2,
			originalEnd: index * 2 + 1,
			generatedStartInReplacement: 0,
			generatedEndInReplacement: 5,
		},
	}));
	const started_at = performance.now();
	const relocations = create_relocations(replacements, undefined);
	const elapsed_ms = performance.now() - started_at;

	assert_equals(relocations.length, count);
	assert_equals(relocations.at(-1)?.generatedStart, (count - 1) * 6);

	if (elapsed_ms >= max_elapsed_ms) {
		throw new Error(`creating replacement relocations took ${elapsed_ms.toFixed(1)}ms`);
	}
});

test("compiles parser-owned markup boundaries without duplicating helpers", () => {
	const source = [
		`<textarea><script>literal</script>{yield* loadText(/}/)}</TEXTAREA>`,
		`<ul><li>one<li>{yield* loadItem(/[}]/)}</ul>`,
		`<div><script>{nested_script}</script><style>.nested { color: red; }</style></div>`,
		`<script lang="ts">const root_marker = true;</script>`,
	].join("\n");
	const result = transform_markup_effect(source, "ParserBoundaries.svelte");
	const ast = parse(result.code, {
		filename: "ParserBoundaries.svelte",
		modern: true,
	}) as AST.Root;

	if (!ast.instance) {
		throw new Error("expected the existing instance script");
	}

	const instance_source = result.code.slice(ast.instance.content.start, ast.instance.content.end);

	assert_string_includes(instance_source, `const root_marker = true;`);
	assert_string_includes(instance_source, `from "svelte-effect-runtime/internal/generators"`);
	assert_string_includes(result.code, `loadText(/}/)`);
	assert_string_includes(result.code, `loadItem(/[}]/)`);
	assert_equals(
		[...result.code.matchAll(/from "svelte-effect-runtime\/internal\/generators"/g)].length,
		1,
	);

	compile(result.code, {
		filename: "ParserBoundaries.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("compiles generated markup after preprocessing a raw SCSS style", async () => {
	const source = [
		`<Widget />`,
		`<style lang="scss">`,
		`  // don't parse this apostrophe as a CSS string`,
		`  $color: red;`,
		`  .button { color: $color; }`,
		`</style>`,
		`<p>{yield* loadColor()}</p>`,
	].join("\n");
	const result = transform_markup_effect(source, "PreprocessorStyle.svelte");
	const processed = await preprocess(
		result.code,
		{ style: () => ({ code: "" }) },
		{ filename: "PreprocessorStyle.svelte" },
	);

	assert_string_includes(result.code, `$color: red;`);
	assert_string_includes(result.code, `loadColor()`);

	compile(processed.code, {
		filename: "PreprocessorStyle.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("injects helper imports into existing instance script tag", () => {
	const source = [`<script>let x = 1;</script>`, `<p>{yield* getValue()}</p>`].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `from "svelte-effect-runtime/internal/generators"`);
	assert_string_includes(result.code, `let x = 1;`);
	assert_string_includes(result.code, `<p>`);
});

test("creates a script tag when none exists", () => {
	const source = `<p>{yield* getValue()}</p>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `<script>`);
	assert_string_includes(result.code, `</script>`);
	assert_string_includes(result.code, `from "svelte-effect-runtime/internal/generators"`);
});

test("skips module context script tags", () => {
	const source = [
		`<script context="module">export const preload = () => {};</script>`,
		`<p>{yield* getValue()}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "Test.svelte");

	const script_count = [...result.code.matchAll(/<script\b/g)].length;
	if (script_count < 2) throw new Error("expected at least 2 script tags");
});

test("allocates helper aliases against module-script bindings", () => {
	const source = [
		`<script context="module">`,
		`  const Dispatcher = {};`,
		`  const Code = {};`,
		`  const ToEffect = {};`,
		`</script>`,
		`<p>{yield* loadValue()}</p>`,
	].join("\n");

	const result = transform_markup_effect(source, "ModuleBindings.svelte");
	const ast = parse(result.code, {
		filename: "ModuleBindings.svelte",
		modern: true,
	}) as AST.Root;

	if (!ast.instance) {
		throw new Error("expected a generated instance script");
	}

	const instance_source = result.code.slice(ast.instance.content.start, ast.instance.content.end);

	assert_string_includes(instance_source, `Dispatcher as Dispatcher_1`);
	assert_string_includes(instance_source, `Code as Code_1`);
	assert_string_includes(instance_source, `ToEffect as ToEffect_1`);
	assert_string_includes(result.code, `Dispatcher_1.emit`);
	assert_string_includes(result.code, `Code_1.Markup.Promise`);
	assert_string_includes(instance_source, `yield* ToEffect_1(loadValue())`);

	compile(result.code, {
		filename: "ModuleBindings.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("is idempotent across repeated transform passes", () => {
	const source = `<p>{yield* getValue()}</p>`;
	const first = transform_markup_effect(source, "Test.svelte");
	const second = transform_markup_effect(first.code, "Test.svelte");

	if (second.code !== first.code) {
		throw new Error("second pass should produce identical output");
	}
});

test("is idempotent for generated event handlers", () => {
	const source = `<button onclick={yield* trackEvent()}>click</button>`;
	const first = transform_markup_effect(source, "Event.svelte");
	const second = transform_markup_effect(first.code, "Event.svelte");

	assert_equals(second.code, first.code);
	assert_equals(second.has_yield, false);
});

test("is idempotent for generated Effect.gen event handlers", () => {
	const source = [
		`<input type="file" onchange={yield* Effect.gen(function* () {`,
		`  const file = event.currentTarget.files?.[0];`,
		`  if (!file) return;`,
		`  yield* upload(file);`,
		`})} />`,
	].join("\n");
	const first = transform_markup_effect(source, "EventEffect.svelte");
	const second = transform_markup_effect(first.code, "EventEffect.svelte");

	compile(first.code, {
		filename: "EventEffect.svelte",
		generate: "server",
		experimental: { async: true },
	});

	assert_equals(second.code, first.code);
	assert_equals(second.has_yield, false);
});

test("does not choke on empty yield* brace contents", () => {
	const source = `<span>{yield* }</span>`;
	const result = transform_markup_effect(source, "Test.svelte");

	if (result.has_yield) {
		assert_string_includes(result.code, `Code.Markup.Promise`);
	}
});

test("does not choke on template literal expressions", () => {
	const source = `<span>{yield* \`prefix-\${id}\`}</span>`;
	const result = transform_markup_effect(source, "Test.svelte");

	assert_string_includes(result.code, `Code.Markup.Promise`);
});

test("rewrites {@html yield* expr} in raw HTML insertion", () => {
	const source = `{@html yield* renderMarkup()}`;
	const result = transform_markup_effect(source, "Test.svelte");
	const server = transform_markup_effect(source, "Test.svelte", { target: "server" });

	assert_string_includes(result.code, `Code.Markup.Promise`);
	assert_string_includes(result.code, `renderMarkup`);
	assert_string_includes(result.code, `fn: () => (function* ()`);
	assert_false(result.code.includes(`function* __SER___markup_effect`));

	/**
	 * A server fallback renders nothing in place of the raw HTML, so the
	 * element never reaches the browser. `{@html}` must stay unwrapped.
	 */
	assert_false(server.code.includes(`ssr_fallback`));
});

test("rejects {@debug yield* expr} instead of emitting invalid Svelte", () => {
	const source = `{@debug yield* inspectVars()}`;
	const error = assert_throws(() => transform_markup_effect(source, "Debug.svelte"));

	assert_string_includes(error.message, "[UNSUPPORTED_MARKUP_EFFECT_POSITION]:");
	assert_string_includes(error.message, `yield* inspectVars()`);
});

test("rejects unsupported attribute yield positions", () => {
	const source = `<Widget value={yield* load()} />`;
	const error = assert_throws(() => transform_markup_effect(source, "Attr.svelte"));

	assert_string_includes(error.message, "[UNSUPPORTED_MARKUP_EFFECT_POSITION]:");
	assert_string_includes(error.message, `yield* load()`);
});

test("rejects unsupported attach tag yield positions", () => {
	const source = `<div {@attach yield* makeAttachment()}></div>`;
	const error = assert_throws(() => transform_markup_effect(source, "Attach.svelte"));

	assert_string_includes(error.message, "[UNSUPPORTED_MARKUP_EFFECT_POSITION]:");
	assert_string_includes(error.message, `yield* makeAttachment()`);
});

test("rejects unsupported spread attribute yield positions", () => {
	const source = `<Widget {...yield* loadProps()} />`;
	const error = assert_throws(() => transform_markup_effect(source, "Spread.svelte"));

	assert_string_includes(error.message, "[UNSUPPORTED_MARKUP_EFFECT_POSITION]:");
	assert_string_includes(error.message, `yield* loadProps()`);
});

test("ignores yield text inside HTML comments", () => {
	const source = `<!-- {yield* Effect.succeed("ignored")} --><p>ok</p>`;
	const result = transform_markup_effect(source, "Comment.svelte");

	assert_equals(result.code, source);
	assert_equals(result.has_yield, false);
});

test("normalizes HMR query strings out of markup cache ids", () => {
	const source = `<p>{yield* getValue()}</p>`;
	const result = transform_markup_effect(source, "Page.svelte?t=12345");

	assert_string_includes(result.code, `"Page.svelte:`);
	if (result.code.includes("Page.svelte?t=12345:")) {
		throw new Error("cache id should not include HMR query string");
	}
});

test("markup promise and run helpers preserve success values", async () => {
	await with_browser_document(async () => {
		reset_dispatcher();

		try {
			const loaded = await promise("markup-promise", [], function* () {
				return yield* Effect.succeed("loaded");
			});
			const saved = await run(function* () {
				return yield* Effect.succeed(42);
			});

			assert_equals(loaded, "loaded");
			assert_equals(saved, 42);
		} finally {
			reset_dispatcher();
		}
	});
});

test("markup value starts effects when a browser document exists", async () => {
	await with_browser_document(async () => {
		reset_dispatcher();

		try {
			let called = false;

			const result = value("browser-hydratable", [], "fallback", function* () {
				return yield* Effect.sync(() => {
					called = true;

					return "resolved";
				});
			});

			await new Promise((resolve) => setTimeout(resolve, 0));

			assert_equals(["fallback", "resolved"].includes(result as string), true);
			assert_equals(called, true);
		} finally {
			reset_dispatcher();
		}
	});
});

test("markup value returns fallback during SSR without starting effects", () => {
	try {
		reset_dispatcher();

		let called = false;

		const result = value("ssr-fallback", [], "fallback", function* () {
			return yield* Effect.sync(() => {
				called = true;

				return "resolved";
			});
		});

		assert_equals(result, "fallback");
		assert_equals(called, false);
	} finally {
		reset_dispatcher();
	}
});

test("markup promise returns SSR fallback without starting effects", async () => {
	try {
		reset_dispatcher();

		let called = false;

		const result = await promise(
			"ssr-promise",
			[],
			function* () {
				called = true;

				return yield* Effect.succeed("resolved");
			},
			"fallback",
		);

		assert_equals(result, "fallback");
		assert_equals(called, false);
	} finally {
		reset_dispatcher();
	}
});

test("markup promise can stay pending during SSR await blocks", async () => {
	try {
		reset_dispatcher();

		let called = false;

		const result = await Promise.race([
			promise(
				"ssr-await-pending",
				[],
				function* () {
					called = true;

					return yield* Effect.succeed("resolved");
				},
				undefined,
				{ ssr: "pending" },
			).then(() => "resolved"),
			new Promise((resolve) => setTimeout(() => resolve("pending"), 0)),
		]);

		assert_equals(result, "pending");
		assert_equals(called, false);
	} finally {
		reset_dispatcher();
	}
});
