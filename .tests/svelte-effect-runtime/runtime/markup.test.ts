import { transform_markup_effect } from "../../../modules/svelte-effect-runtime/src/markup/transform.ts";
import { sanitize_markup } from "../../../modules/svelte-effect-runtime/src/markup/transform/scan.ts";
import { reset_dispatcher } from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { promise } from "../../../modules/svelte-effect-runtime/src/markup/promise.ts";
import { value } from "../../../modules/svelte-effect-runtime/src/markup/value.ts";
import { run } from "../../../modules/svelte-effect-runtime/src/markup/run.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { compile } from "svelte/compiler";
import { Effect } from "effect";

type DocumentHost = typeof globalThis & { document?: unknown };

async function with_browser_document<A>(
  run_test: () => A | Promise<A>,
): Promise<A> {
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

// ─── Identity / pass-through ─────────────────────────────────

function assert_rejects_markup_rune_yield(
  source: string,
  rune_name: string,
): void {
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(error.message, "[ASYNC_EFFECT_IN_SYNC_RUNE]:");
  assertStringIncludes(error.message, rune_name);
}

Deno.test("passes through markup with no yield* unchanged", () => {
  const source = `<h1>Hello</h1><p>World</p>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `<h1>Hello</h1>`);
  assertStringIncludes(result.code, `<p>World</p>`);
  if (result.has_yield) throw new Error("has_yield should be false");
});

Deno.test("skips excluded block braces without per-brace tag scans", () => {
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

    const result = sanitize_markup(source, "Excluded.svelte");

    assertEquals(result.candidates.length, 1);
    assertStringIncludes(result.code, `__SER___markup_placeholder_0`);
  } finally {
    Object.defineProperty(String.prototype, "matchAll", {
      configurable: true,
      value: original_match_all,
    });
  }

  if (match_all_calls > 8) {
    throw new Error(
      `expected precomputed excluded ranges, got ${match_all_calls} scans`,
    );
  }
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

Deno.test("rewrites {yield* expr} as async promise expression", () => {
  const source = `<span>{yield* renderDate()}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `renderDate()`);
  assertStringIncludes(result.code, `function* __SER___markup_effect`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {yield* expr} with free identifier deps", () => {
  const source = `<span>{yield* format(user)}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `format`);
  assertStringIncludes(result.code, `user`);
  assertStringIncludes(result.code, `[format, user]`);
});

Deno.test("rewrites yielded markup expressions using Effect import aliases", () => {
  const source = [
    `<script>import { Effect as E } from "effect";</script>`,
    `<span>{yield* E.succeed(42)}</span>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `yield* E.succeed(42)`);
  assertStringIncludes(result.code, `import { Effect as E } from "effect";`);

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

// ─── Block expressions ───────────────────────────────────────

Deno.test("rewrites {#if yield* expr} in condition", () => {
  const source = `{#if yield* hasAccess()}<p>yes</p>{/if}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `hasAccess`);
  assertStringIncludes(result.code, `{#if`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {:else if yield* expr} in alternate condition", () => {
  const source = `{#if a}{:else if yield* checkFlag()}<p>flag</p>{/if}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `checkFlag`);
  assertStringIncludes(result.code, `:else if`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#each yield* expr as item} in list", () => {
  const source = `{#each yield* getItems() as item}<li>{item}</li>{/each}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `getItems`);
  assertStringIncludes(result.code, `{#each`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#await yield* expr} as promise() call", () => {
  const source =
    `{#await yield* loadData()}<p>loading</p>{:then val}<p>{val}</p>{/await}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Code.Markup.Promise`);
  assertStringIncludes(result.code, `loadData`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#await yield* expr} with :catch clause", () => {
  const source =
    `{#await yield* fetchUser()}<p>loading</p>{:then u}<p>{u.name}</p>{:catch err}<p>Error: {err.message}</p>{/await}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Code.Markup.Promise`);
  assertStringIncludes(result.code, `fetchUser`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {@render yield* fn()} as cached optional snippet call", () => {
  const source = `{@render yield* getSnippet()}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `(`);
  assertStringIncludes(result.code, `)()`);
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

Deno.test("rewrites yield inside render tag arguments without double-calling snippet output", () => {
  const source = [
    `<script>let { load } = $props();</script>`,
    `{#snippet child(value)}<p>{value}</p>{/snippet}`,
    `{@render child(yield* load())}`,
  ].join("");
  const result = transform_markup_effect(source, "RenderArg.svelte");

  assertStringIncludes(
    result.code,
    `{@render child(await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `return (yield* load());`);
  if (result.code.includes(`)()}`)) {
    throw new Error("render arguments must not double-call snippet output");
  }

  compile(result.code, {
    filename: "RenderArg.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites {@const x = yield* expr} in const initializer", () => {
  const source = `{@const x = yield* compute()}{x}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `compute`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {const x = yield* expr} in declaration initializer", () => {
  const source = `{const x = yield* compute()}{x}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `{const x = await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `compute`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {let x = yield* expr} in declaration initializer", () => {
  const source = `{let x = yield* compute()}{x}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `{let x = await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `compute`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("preserves declaration rune placement while lowering yield*", () => {
  const source = [
    `<script>`,
    `  function getPublicationRemote() {}`,
    `  const params = { publication_id: "p1" };`,
    `</script>`,
    `{let publication = $derived(yield* getPublicationRemote({ publicationId: params.publication_id }))}`,
    `<p>{publication}</p>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `$derived(await Dispatcher.emit({ type: Code.Markup.Promise`,
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

Deno.test("client declaration tags lower to awaited promise reads", () => {
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

  assertStringIncludes(
    result.code,
    `$derived(await Dispatcher.emit({ type: Code.Markup.Promise`,
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

Deno.test("editor declaration tags lower to awaited promise reads", () => {
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

  assertStringIncludes(
    result.code,
    `$derived(await Dispatcher.emit({ type: Code.Markup.Promise`,
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

Deno.test("server declaration tags lower to awaited promise reads", () => {
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

  assertStringIncludes(
    result.code,
    `$derived(await Dispatcher.emit({ type: Code.Markup.Promise`,
  );

  compile(result.code, {
    filename: "Publication.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("client render tags use awaited promise calls", () => {
  const source = `{@render yield* getSnippet()}`;
  const result = transform_markup_effect(source, "RenderClient.svelte", {
    target: "client",
  });

  assertStringIncludes(result.code, `await Dispatcher.emit`);
  assertStringIncludes(result.code, `Code.Markup.Promise`);
  assertStringIncludes(result.code, `)()`);

  compile(result.code, {
    filename: "RenderClient.svelte",
    generate: "client",
    experimental: { async: true },
  });
});

Deno.test("server render tags use noop snippet fallback during SSR", () => {
  const source = `{@render yield* getSnippet()}`;
  const result = transform_markup_effect(source, "RenderServer.svelte", {
    target: "server",
  });

  assertStringIncludes(result.code, `await Dispatcher.emit`);
  assertStringIncludes(result.code, `ssr_fallback: () => undefined`);
  assertStringIncludes(result.code, `)()`);

  compile(result.code, {
    filename: "RenderServer.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("client common markup contexts compile with async option", () => {
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

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );

  compile(result.code, {
    filename: "ClientContexts.svelte",
    generate: "client",
    experimental: { async: true },
  });
});

Deno.test("server common markup contexts compile with async option", () => {
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

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `ssr_fallback: undefined`);
  assertStringIncludes(result.code, `ssr_fallback: []`);

  compile(result.code, {
    filename: "ServerContexts.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("lowers multiple yield* expressions inside declaration runes", () => {
  const source = [
    `<script>`,
    `  function first() {}`,
    `  function second() {}`,
    `</script>`,
    `{let value = $derived((yield* first()) + (yield* second()))}`,
    `<p>{value}</p>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");
  const promise_calls =
    [...result.code.matchAll(/Code\.Markup\.Promise/g)].length;

  assertEquals(promise_calls, 2);
  assertStringIncludes(
    result.code,
    `$derived((await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(
    result.code,
    `+ (await Dispatcher.emit({ type: Code.Markup.Promise`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites destructured declaration tag initializers", () => {
  const source = `{const { value } = yield* load()}{value}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `{const { value } = await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `load`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites destructured declaration tag defaults", () => {
  const source = [
    `<script>`,
    `  const data = {};`,
    `  function fallbackValue() {}`,
    `</script>`,
    `{let { value = yield* fallbackValue() } = data}`,
    `<p>{value}</p>`,
  ].join("\n");
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `{let { value = await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `fallbackValue`);

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites multiple declaration tag initializers", () => {
  const source = `{const a = yield* getA(), b = yield* getB()}{a}{b}`;
  const result = transform_markup_effect(source, "Test.svelte");

  const promise_calls =
    [...result.code.matchAll(/Code\.Markup\.Promise/g)].length;

  assertEquals(promise_calls, 2);
  assertStringIncludes(result.code, `getA`);
  assertStringIncludes(result.code, `getB`);
});

Deno.test("rejects yield* in synchronous-only markup declaration runes", () => {
  const cases: Array<[string, string]> = [
    [`{const value = $state.eager(yield* loadEager())}`, "$state.eager"],
    [`{const props = $props(yield* loadProps())}`, "$props"],
    [`{const id = $props.id(yield* loadId())}`, "$props.id"],
    [
      `{const pending = $effect.pending(yield* loadPending())}`,
      "$effect.pending",
    ],
    [
      `{const tracking = $effect.tracking(yield* loadTracking())}`,
      "$effect.tracking",
    ],
    [`{const host = $host(yield* loadHost())}`, "$host"],
    [`{const value = $inspect(yield* loadDebug())}`, "$inspect"],
    [`{const value = $derived.by(() => yield* compute())}`, "$derived.by"],
    [`{const value = $effect(() => yield* runEffect())}`, "$effect"],
  ];

  for (const [source, rune_name] of cases) {
    assert_rejects_markup_rune_yield(source, rune_name);
  }
});

Deno.test("rejects yield* in synchronous-only markup const tag runes", () => {
  const source =
    `{#if ready}{@const value = $inspect(yield* loadDebug())}{/if}`;

  assert_rejects_markup_rune_yield(source, "$inspect");
});

Deno.test("rewrites {#key yield* expr} in key expression", () => {
  const source = `{#key yield* getKey()}<p>content</p>{/key}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(result.code, `getKey`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

// ─── Event handlers ──────────────────────────────────────────

Deno.test("rewrites onclick event effect expressions as run wrappers", () => {
  const source = `<button onclick={yield* trackEvent()}>click</button>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `onclick={(event) =>`);
  assertStringIncludes(result.code, `Code.Markup.Run`);
  assertStringIncludes(
    result.code,
    `Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* trackEvent(); } });`,
  );
  if (result.code.includes("void Code.Markup.Run")) {
    throw new Error("event handler wrappers should not emit void");
  }
  assertStringIncludes(result.code, `trackEvent`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites event effect expressions with generated event parameter", () => {
  const source =
    `<input oninput={yield* validate(event.currentTarget.value)} />`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `oninput={(event) =>`);
  assertStringIncludes(result.code, `event.currentTarget.value`);
  assertStringIncludes(
    result.code,
    `Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* validate(event.currentTarget.value); } });`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites onsubmit event effect expressions", () => {
  const source = `<form onsubmit={yield* submit()}></form>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `onsubmit={(event) =>`);
  assertStringIncludes(result.code, `Code.Markup.Run`);
  assertStringIncludes(result.code, `yield* submit()`);
});

Deno.test("rewrites on:click event effect expressions", () => {
  const source = `<button on:click={yield* save(event)}>save</button>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `on:click={(event) =>`);
  assertStringIncludes(result.code, `Code.Markup.Run`);
  assertStringIncludes(result.code, `yield* save(event)`);
});

Deno.test("rewrites custom event-like handler attributes", () => {
  const source = `<button oncustom={yield* handle(event)}>save</button>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `oncustom={(event) =>`);
  assertStringIncludes(result.code, `yield* handle(event)`);
});

Deno.test("rewrites native-style form validation handlers only when marked with yield*", () => {
  const source =
    `<form {...createPost} oninput={yield* createPost.validate()}></form>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `oninput={(event) =>`);
  assertStringIncludes(
    result.code,
    `Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* createPost.validate(); } });`,
  );
  assertStringIncludes(
    result.code,
    `from "svelte-effect-runtime/internal/generators"`,
  );
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("injects dispatcher import when another generated helper import already exists", () => {
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
  const value_imports =
    [...result.code.matchAll(/\bvalue as __ser_markup_value\b/g)].length;

  assertEquals(value_imports, 1);
  assertStringIncludes(
    result.code,
    `import { Dispatcher, Code } from "svelte-effect-runtime/internal/generators";`,
  );
  assertStringIncludes(
    result.code,
    `Dispatcher.emit({ type: Code.Markup.Run, fn: function* () { yield* Effect.gen(function* () {`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "client",
    experimental: { async: true },
  });
});

Deno.test("leaves non-Effect event handlers untouched", () => {
  const source =
    `<form {...formSnap} oninput={() => formSnap.validate()}></form>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertEquals(result.code, source);
  if (result.has_yield) throw new Error("has_yield should be false");
});

Deno.test("rejects yield* inside event callback handlers", () => {
  const source = `<button onclick={() => yield* save()}>save</button>`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(
    error.message,
    "yield* in markup event handlers must be written directly",
  );
  assertStringIncludes(error.message, `onclick={yield* UpvotePost(id)}`);
  assertStringIncludes(error.message, `onclick={() => yield* UpvotePost(id)}`);
});

Deno.test("rejects event callback handlers with parameters", () => {
  const source = `<input oninput={(event) => yield* validate(event)} />`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(
    error.message,
    "yield* in markup event handlers must be written directly",
  );
});

Deno.test("rejects legacy on directive callback handlers", () => {
  const source = `<button on:click={() => yield* save()}>save</button>`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(
    error.message,
    "yield* in markup event handlers must be written directly",
  );
});

Deno.test("rejects function expression event callbacks", () => {
  const source =
    `<button onclick={function () { yield* save(); }}>save</button>`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(
    error.message,
    "yield* in markup event handlers must be written directly",
  );
});

Deno.test("allows direct explicit Effect.gen event composition", () => {
  const source =
    `<button onclick={yield* Effect.gen(function* () { yield* save(); })}>save</button>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `onclick={(event) =>`);
  assertStringIncludes(
    result.code,
    `yield* Effect.gen(function* () { yield* save(); })`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites nested yield* in Effect.matchCause event handlers", () => {
  const source = [
    `<button onclick={yield* savePost().pipe(Effect.matchCause({`,
    `  onSuccess: (result) => { return yield* notify(result); },`,
    `  onFailure: (cause) => "failed"`,
    `}))}>save</button>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Effect.matchCauseEffect`);
  assertStringIncludes(
    result.code,
    `onSuccess: (result) => Effect.gen(function* () { return yield* notify(result); })`,
  );
  assertStringIncludes(
    result.code,
    `onFailure: (cause) => Effect.sync(() => ("failed"))`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("preserves plain matchCause success callback values when upgrading", () => {
  const source = [
    `<button onclick={yield* savePost().pipe(Effect.matchCause({`,
    `  onSuccess: (result) => result.id,`,
    `  onFailure: (cause) => { return yield* recover(cause); }`,
    `}))}>save</button>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Effect.matchCauseEffect`);
  assertStringIncludes(
    result.code,
    `onSuccess: (result) => Effect.sync(() => (result.id))`,
  );

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

Deno.test("preserves function-expression match callback values when upgrading", () => {
  const source = [
    `<button onclick={yield* savePost().pipe(Effect.match({`,
    `  onSuccess: function (result) { return result.id; },`,
    `  onFailure: function (error) { return yield* recover(error); }`,
    `}))}>save</button>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Effect.matchEffect`);
  assertStringIncludes(
    result.code,
    `onSuccess: function (result) { return Effect.sync(() => { return result.id; }); }`,
  );
  assertStringIncludes(
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

Deno.test("rewrites nested yield* inside explicit Effect.gen event handlers", () => {
  const source = [
    `<button onclick={yield* Effect.gen(function* () {`,
    `  yield* savePost().pipe(Effect.matchCause({`,
    `    onSuccess: (result) => { return yield* notify(result); },`,
    `    onFailure: (cause) => "failed"`,
    `  }));`,
    `})}>save</button>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Effect.matchCauseEffect`);
  assertStringIncludes(
    result.code,
    `onSuccess: (result) => Effect.gen(function* () { return yield* notify(result); })`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites nested yield* in effect-returning event callbacks", () => {
  const source = [
    `<button onclick={yield* loadPost().pipe(`,
    `  Effect.flatMap((post) => { return yield* notify(post); })`,
    `)}>save</button>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `Effect.flatMap((post) => Effect.gen(function* () { return yield* notify(post); }))`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites nested yield* through aliased Effect imports", () => {
  const source = [
    `<script>import { Effect as E } from "effect";</script>`,
    `<button onclick={yield* savePost().pipe(E.matchCause({`,
    `  onSuccess: (result) => { return yield* notify(result); },`,
    `  onFailure: (cause) => "failed"`,
    `}))}>save</button>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `E.matchCauseEffect`);
  assertStringIncludes(
    result.code,
    `onSuccess: (result) => E.gen(function* () { return yield* notify(result); })`,
  );
  assertStringIncludes(
    result.code,
    `onFailure: (cause) => E.sync(() => ("failed"))`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites nested yield* through effect module namespaces", () => {
  const source = [
    `<script>import * as E from "effect/Effect";</script>`,
    `<button onclick={yield* loadPost().pipe(`,
    `  E.flatMap((post) => { return yield* notify(post); })`,
    `)}>save</button>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `E.flatMap((post) => E.gen(function* () { return yield* notify(post); }))`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites nested yield* through effect package namespaces", () => {
  const source = [
    `<script>import * as Fx from "effect";</script>`,
    `<button onclick={yield* savePost().pipe(Fx.Effect.match({`,
    `  onSuccess: (result) => { return yield* notify(result); },`,
    `  onFailure: () => "failed"`,
    `}))}>save</button>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Fx.Effect.matchEffect`);
  assertStringIncludes(
    result.code,
    `onSuccess: (result) => Fx.Effect.gen(function* () { return yield* notify(result); })`,
  );
  assertStringIncludes(
    result.code,
    `onFailure: () => Fx.Effect.sync(() => ("failed"))`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites nested yield* through direct effect function imports", () => {
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

  assertStringIncludes(
    result.code,
    `import { Effect as __SER___Effect } from "effect";`,
  );
  assertStringIncludes(result.code, `__SER___Effect.matchCauseEffect`);
  assertStringIncludes(
    result.code,
    `onSuccess: (result) => __SER___Effect.gen(function* () { return yield* notify(result); })`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("rewrites nested yield* in non-event markup expressions", () => {
  const source = [
    `<script>import { Effect as E } from "effect";</script>`,
    `<p>{yield* loadPost().pipe(`,
    `  E.flatMap((post) => { return yield* renderPost(post); })`,
    `)}</p>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `E.flatMap((post) => E.gen(function* () { return yield* renderPost(post); }))`,
  );

  compile(result.code, {
    filename: "Test.svelte",
    generate: "server",
    experimental: { async: true },
  });
});

Deno.test("tracks free identifiers inside nested generator expressions", () => {
  const source =
    `<p>{yield* Effect.gen(function* () { return yield* load(user); })}</p>`;
  const result = transform_markup_effect(source, "Deps.svelte");

  assertStringIncludes(result.code, `[Effect, load, user]`);
  assertStringIncludes(
    result.code,
    `function* __SER___markup_effect`,
  );
});

Deno.test("rejects unrelated matchCause receivers with nested yield*", () => {
  const source = [
    `<button onclick={yield* savePost().pipe(foo.matchCause({`,
    `  onSuccess: (result) => { return yield* notify(result); },`,
    `  onFailure: () => "failed"`,
    `}))}>save</button>`,
  ].join("\n");
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(error.message, "[ASYNC_EFFECT_IN_EVENT_CALLBACK]:");
  assertStringIncludes(
    error.message,
    "yield* cannot be used inside a nested non-generator callback",
  );
});

Deno.test("rejects callbacks hiding yield* inside nested generators", () => {
  const source =
    `<button onclick={() => Effect.gen(function* () { yield* save(); })}>save</button>`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(
    error.message,
    "yield* in markup event handlers must be written directly",
  );
});

Deno.test("rejects yield* inside nested non-generator event callbacks", () => {
  const source =
    `<button onclick={yield* Effect.try(() => yield* save())}>save</button>`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(error.message, "[ASYNC_EFFECT_IN_EVENT_CALLBACK]:");
  assertStringIncludes(
    error.message,
    "yield* cannot be used inside a nested non-generator callback",
  );
  assertStringIncludes(error.message, `onclick={yield* UpvotePost(id)}`);
  assertStringIncludes(
    error.message,
    `Effect.try and Effect.sync callbacks are plain synchronous JavaScript`,
  );
  assertStringIncludes(
    error.message,
    `onclick={yield* UpvotePost(id).pipe(Effect.catch(() => Effect.void))}`,
  );
});

Deno.test("rejects nested callback yield* even with an outer yield*", () => {
  const source =
    `<button onclick={yield* Effect.try(() => yield* save())}>save</button>`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Test.svelte"),
  );

  assertStringIncludes(error.message, "[ASYNC_EFFECT_IN_EVENT_CALLBACK]:");
  assertStringIncludes(
    error.message,
    "yield* cannot be used inside a nested non-generator callback",
  );
});

// ─── Multiple yield* in one file ─────────────────────────────

Deno.test("handles multiple yield* expressions in markup", () => {
  const source = [
    `<p>{yield* getA()}</p>`,
    `<p>{yield* getB()}</p>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  /** Count actual helper call sites (not import aliases). */
  const promise_calls =
    [...result.code.matchAll(/Code\.Markup\.Promise/g)].length;
  if (promise_calls !== 2) {
    throw new Error(`expected 2 promise calls, got ${promise_calls}`);
  }
});

// ─── Script tag injection ────────────────────────────────────

Deno.test("records source relocations for lowered markup hover spans", () => {
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

  const each_original_start = source.indexOf("yield* GetPosts()");
  const event_original_start = source.indexOf("yield* UpvotePost(id)");

  const each_relocation = relocations.find((relocation) =>
    relocation.originalStart === each_original_start
  );
  const event_relocation = relocations.find((relocation) =>
    relocation.originalStart === event_original_start
  );

  if (!each_relocation) {
    throw new Error("expected relocation for each expression");
  }

  if (!event_relocation) {
    throw new Error("expected relocation for event handler expression");
  }

  assertEquals(
    source.slice(each_relocation.originalStart, each_relocation.originalEnd),
    "yield* GetPosts()",
  );
  assertEquals(
    result.code.slice(
      each_relocation.generatedStart,
      each_relocation.generatedEnd,
    ),
    "yield* GetPosts()",
  );
  assertEquals(
    source.slice(event_relocation.originalStart, event_relocation.originalEnd),
    "yield* UpvotePost(id)",
  );
  assertEquals(
    result.code.slice(
      event_relocation.generatedStart,
      event_relocation.generatedEnd,
    ),
    "yield* UpvotePost(id)",
  );
});

Deno.test("generates distinct markup cache ids for different files", () => {
  const first = transform_markup_effect(
    `<p>{yield* getUser()}</p>`,
    "User.svelte",
  );

  const second = transform_markup_effect(
    `<p>{yield* getPost()}</p>`,
    "Post.svelte",
  );

  const pattern = /id: ("[^"]+"),/;
  const first_id = first.code.match(pattern)?.[1];
  const second_id = second.code.match(pattern)?.[1];

  assertEquals(first_id === second_id, false);
});

Deno.test("injects helper imports into existing instance script tag", () => {
  const source = [
    `<script>let x = 1;</script>`,
    `<p>{yield* getValue()}</p>`,
  ].join("\n");

  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(
    result.code,
    `from "svelte-effect-runtime/internal/generators"`,
  );
  assertStringIncludes(result.code, `let x = 1;`);
  // The original content must be preserved
  assertStringIncludes(result.code, `<p>`);
});

Deno.test("creates a script tag when none exists", () => {
  const source = `<p>{yield* getValue()}</p>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `<script>`);
  assertStringIncludes(result.code, `</script>`);
  assertStringIncludes(
    result.code,
    `from "svelte-effect-runtime/internal/generators"`,
  );
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

Deno.test("is idempotent across repeated transform passes", () => {
  const source = `<p>{yield* getValue()}</p>`;
  const first = transform_markup_effect(source, "Test.svelte");
  const second = transform_markup_effect(first.code, "Test.svelte");

  if (second.code !== first.code) {
    throw new Error("second pass should produce identical output");
  }
});

Deno.test("is idempotent for generated event handlers", () => {
  const source = `<button onclick={yield* trackEvent()}>click</button>`;
  const first = transform_markup_effect(source, "Event.svelte");
  const second = transform_markup_effect(first.code, "Event.svelte");

  assertEquals(second.code, first.code);
  assertEquals(second.has_yield, false);
});

// ─── Edge cases ──────────────────────────────────────────────

Deno.test("is idempotent for generated Effect.gen event handlers", () => {
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

  assertEquals(second.code, first.code);
  assertEquals(second.has_yield, false);
});

Deno.test("does not choke on empty yield* brace contents", () => {
  const source = `<span>{yield* }</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  // Regex match on yield* passes, but TS parser fails — should not crash
  if (result.has_yield) {
    // If it detected yield*, the output should still be valid
    assertStringIncludes(result.code, `Code.Markup.Promise`);
  }
});

Deno.test("does not choke on template literal expressions", () => {
  const source = `<span>{yield* \`prefix-\${id}\`}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Code.Markup.Promise`);
});

Deno.test("rewrites {@html yield* expr} in raw HTML insertion", () => {
  const source = `{@html yield* renderMarkup()}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `Code.Markup.Promise`);
  assertStringIncludes(result.code, `renderMarkup`);
});

Deno.test("rejects {@debug yield* expr} instead of emitting invalid Svelte", () => {
  const source = `{@debug yield* inspectVars()}`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Debug.svelte"),
  );

  assertStringIncludes(
    error.message,
    "[UNSUPPORTED_MARKUP_EFFECT_POSITION]:",
  );
  assertStringIncludes(error.message, `yield* inspectVars()`);
});

Deno.test("rejects unsupported attribute yield positions", () => {
  const source = `<Widget value={yield* load()} />`;
  const error = assertThrows(
    () => transform_markup_effect(source, "Attr.svelte"),
  );

  assertStringIncludes(
    error.message,
    "[UNSUPPORTED_MARKUP_EFFECT_POSITION]:",
  );
  assertStringIncludes(error.message, `yield* load()`);
});

Deno.test("ignores yield text inside HTML comments", () => {
  const source = `<!-- {yield* Effect.succeed("ignored")} --><p>ok</p>`;
  const result = transform_markup_effect(source, "Comment.svelte");

  assertEquals(result.code, source);
  assertEquals(result.has_yield, false);
});

Deno.test("normalizes HMR query strings out of markup cache ids", () => {
  const source = `<p>{yield* getValue()}</p>`;
  const result = transform_markup_effect(source, "Page.svelte?t=12345");

  assertStringIncludes(result.code, `"Page.svelte:`);
  if (result.code.includes("Page.svelte?t=12345:")) {
    throw new Error("cache id should not include HMR query string");
  }
});

Deno.test("markup promise and run helpers preserve success values", async () => {
  await with_browser_document(async () => {
    reset_dispatcher();

    try {
      const loaded = await promise("markup-promise", [], function* () {
        return yield* Effect.succeed("loaded");
      });
      const saved = await run(function* () {
        return yield* Effect.succeed(42);
      });

      assertEquals(loaded, "loaded");
      assertEquals(saved, 42);
    } finally {
      reset_dispatcher();
    }
  });
});

Deno.test("markup value starts effects when a browser document exists", async () => {
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

      assertEquals(["fallback", "resolved"].includes(result as string), true);
      assertEquals(called, true);
    } finally {
      reset_dispatcher();
    }
  });
});

Deno.test("markup value returns fallback during SSR without starting effects", () => {
  try {
    reset_dispatcher();

    let called = false;

    const result = value("ssr-fallback", [], "fallback", function* () {
      return yield* Effect.sync(() => {
        called = true;

        return "resolved";
      });
    });

    assertEquals(result, "fallback");
    assertEquals(called, false);
  } finally {
    reset_dispatcher();
  }
});

Deno.test("markup promise returns SSR fallback without starting effects", async () => {
  try {
    reset_dispatcher();

    let called = false;

    const result = await promise("ssr-promise", [], function* () {
      called = true;

      return yield* Effect.succeed("resolved");
    }, "fallback");

    assertEquals(result, "fallback");
    assertEquals(called, false);
  } finally {
    reset_dispatcher();
  }
});

Deno.test("markup promise can stay pending during SSR await blocks", async () => {
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

    assertEquals(result, "pending");
    assertEquals(called, false);
  } finally {
    reset_dispatcher();
  }
});
