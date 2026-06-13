import { transform_markup_effect } from "../../../modules/svelte-effect-runtime/src/markup/transform.ts";
import { reset_dispatcher } from "../../../modules/svelte-effect-runtime/src/dispatcher.ts";
import { value } from "../../../modules/svelte-effect-runtime/src/markup/value.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { compile } from "svelte/compiler";
import { Effect } from "effect";

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

Deno.test("rewrites {yield* expr} as async promise expression", () => {
  const source = `<span>{yield* renderDate()}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `await __ser_markup_promise`);
  assertStringIncludes(result.code, `renderDate()`);
  assertStringIncludes(result.code, `function* __ser_markup_effect`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {yield* expr} with free identifier deps", () => {
  const source = `<span>{yield* format(user)}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `await __ser_markup_promise`);
  assertStringIncludes(result.code, `format`);
  assertStringIncludes(result.code, `user`);
  assertStringIncludes(result.code, `[format, user]`);
});

// ─── Block expressions ───────────────────────────────────────

Deno.test("rewrites {#if yield* expr} in condition", () => {
  const source = `{#if yield* hasAccess()}<p>yes</p>{/if}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `await __ser_markup_promise`);
  assertStringIncludes(result.code, `hasAccess`);
  assertStringIncludes(result.code, `{#if`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {:else if yield* expr} in alternate condition", () => {
  const source = `{#if a}{:else if yield* checkFlag()}<p>flag</p>{/if}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `await __ser_markup_promise`);
  assertStringIncludes(result.code, `checkFlag`);
  assertStringIncludes(result.code, `:else if`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#each yield* expr as item} in list", () => {
  const source = `{#each yield* getItems() as item}<li>{item}</li>{/each}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `await __ser_markup_promise`);
  assertStringIncludes(result.code, `getItems`);
  assertStringIncludes(result.code, `{#each`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#await yield* expr} as promise() call", () => {
  const source =
    `{#await yield* loadData()}<p>loading</p>{:then val}<p>{val}</p>{/await}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_promise`);
  assertStringIncludes(result.code, `loadData`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {#await yield* expr} with :catch clause", () => {
  const source =
    `{#await yield* fetchUser()}<p>loading</p>{:then u}<p>{u.name}</p>{:catch err}<p>Error: {err.message}</p>{/await}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_promise`);
  assertStringIncludes(result.code, `fetchUser`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {@render yield* fn()} as awaited snippet call", () => {
  const source = `{@render yield* getSnippet()}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `await __ser_markup_promise`);
  assertStringIncludes(result.code, `(`);
  assertStringIncludes(result.code, `)()`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {@const x = yield* expr} in const initializer", () => {
  const source = `{@const x = yield* compute()}{x}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `await __ser_markup_promise`);
  assertStringIncludes(result.code, `compute`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {const x = yield* expr} in declaration initializer", () => {
  const source = `{const x = yield* compute()}{x}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `{const x = await __ser_markup_promise`);
  assertStringIncludes(result.code, `compute`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites {let x = yield* expr} in declaration initializer", () => {
  const source = `{let x = yield* compute()}{x}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `{let x = await __ser_markup_promise`);
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

  assertStringIncludes(result.code, `$derived(await __ser_markup_promise`);

  if (result.code.includes("[$derived")) {
    throw new Error("runes must not be captured as runtime dependencies");
  }

  compile(result.code, {
    filename: "Test.svelte",
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
    [...result.code.matchAll(/\b__ser_markup_promise\(/g)].length;

  assertEquals(promise_calls, 2);
  assertStringIncludes(result.code, `$derived((await __ser_markup_promise`);
  assertStringIncludes(result.code, `+ (await __ser_markup_promise`);

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
    `{const { value } = await __ser_markup_promise`,
  );
  assertStringIncludes(result.code, `load`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

Deno.test("rewrites multiple declaration tag initializers", () => {
  const source = `{const a = yield* getA(), b = yield* getB()}{a}{b}`;
  const result = transform_markup_effect(source, "Test.svelte");

  const promise_calls =
    [...result.code.matchAll(/\b__ser_markup_promise\(/g)].length;

  assertEquals(promise_calls, 2);
  assertStringIncludes(result.code, `getA`);
  assertStringIncludes(result.code, `getB`);
});

Deno.test("rewrites {#key yield* expr} in key expression", () => {
  const source = `{#key yield* getKey()}<p>content</p>{/key}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `await __ser_markup_promise`);
  assertStringIncludes(result.code, `getKey`);
  if (!result.has_yield) throw new Error("has_yield should be true");
});

// ─── Event handlers ──────────────────────────────────────────

Deno.test("rewrites onclick event effect expressions as run wrappers", () => {
  const source = `<button onclick={yield* trackEvent()}>click</button>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `onclick={(event) =>`);
  assertStringIncludes(result.code, `__ser_markup_run`);
  assertStringIncludes(
    result.code,
    `void __ser_markup_run(function* () { yield* trackEvent(); });`,
  );
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
    `void __ser_markup_run(function* () { yield* validate(event.currentTarget.value); });`,
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
  assertStringIncludes(result.code, `__ser_markup_run`);
  assertStringIncludes(result.code, `yield* submit()`);
});

Deno.test("rewrites on:click event effect expressions", () => {
  const source = `<button on:click={yield* save(event)}>save</button>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `on:click={(event) =>`);
  assertStringIncludes(result.code, `__ser_markup_run`);
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
    `void __ser_markup_run(function* () { yield* createPost.validate(); });`,
  );
  assertStringIncludes(
    result.code,
    `from "svelte-effect-runtime/internal/generators"`,
  );
  if (!result.has_yield) throw new Error("has_yield should be true");
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
    [...result.code.matchAll(/\b__ser_markup_promise\(/g)].length;
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

  const pattern = /__ser_markup_promise\((".*?"),/;
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
    assertStringIncludes(result.code, `__ser_markup_promise`);
  }
});

Deno.test("does not choke on template literal expressions", () => {
  const source = `<span>{yield* \`prefix-\${id}\`}</span>`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_promise`);
});

Deno.test("rewrites {@html yield* expr} in raw HTML insertion", () => {
  const source = `{@html yield* renderMarkup()}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_promise`);
  assertStringIncludes(result.code, `renderMarkup`);
});

Deno.test("rewrites {@debug yield* expr} in debug expression", () => {
  const source = `{@debug yield* inspectVars()}`;
  const result = transform_markup_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_promise`);
  assertStringIncludes(result.code, `inspectVars`);
});

Deno.test("markup value starts effects during SSR to register hydratables", async () => {
  reset_dispatcher();

  let called = false;

  const result = value("ssr-hydratable", [], "fallback", function* () {
    return yield* Effect.sync(() => {
      called = true;

      return "resolved";
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(["fallback", "resolved"].includes(result as string), true);
  assertEquals(called, true);

  reset_dispatcher();
});
