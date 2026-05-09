import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { preprocess } from "svelte/compiler";
import { effectPreprocess } from "../preprocess.ts";

Deno.test("leaves regular scripts untouched", async () => {
  const source = `<script lang="ts">
  const value = 42;
</script>

<p>{value}</p>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "Regular.svelte",
  });

  assertEquals(result.code, source);
});

Deno.test("rewrites effect-enabled scripts into a mount-time Effect program", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const count = yield* Effect.succeed(42);
</script>

<p>{count}</p>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "Counter.svelte",
  });

  assertStringIncludes(
    result.code,
    `import { onMount as __svelteEffectRuntimeOnMount } from "svelte";`,
  );
  assertStringIncludes(
    result.code,
    `import { get_effect_runtime_or_throw as __svelteEffectRuntimeGetRuntime`,
  );
  assertStringIncludes(
    result.code,
    `const __svelteEffectRuntimeProgram = __svelteEffectRuntimeEffect.gen(function* () {`,
  );
  assertMatch(
    result.code,
    /const __svelteEffectRuntime_count_\d+ = \(\) => Effect\.succeed\(42\);/,
  );
  assertMatch(
    result.code,
    /let count: __svelteEffectRuntimeYielded<ReturnType<typeof __svelteEffectRuntime_count_\d+>> = \$state\(undefined as unknown as __svelteEffectRuntimeYielded<ReturnType<typeof __svelteEffectRuntime_count_\d+>>\);/,
  );
  assertMatch(
    result.code,
    /count = yield\* __svelteEffectRuntime_count_\d+\(\);/,
  );
});

Deno.test("keeps declarations hoisted while moving executable statements", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  let count = $state(0);
  const label = "ready";
  console.log(label);
  count = yield* Effect.succeed(2);
</script>

<p>{label}: {count}</p>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "Mixed.svelte",
  });

  assertStringIncludes(result.code, `let count = $state(0);`);
  assertStringIncludes(result.code, `const label = "ready";`);
  assertStringIncludes(result.code, `console.log(label);`);
  assertStringIncludes(result.code, `count = yield* Effect.succeed(2);`);
});

Deno.test("preserves explicit type annotations when lowering yield declarations", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const count: number = yield* Effect.succeed(1);
</script>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "Typed.svelte",
  });

  assertStringIncludes(
    result.code,
    `let count: number = $state(undefined as unknown as number);`,
  );
});

Deno.test("supports destructuring declarations that depend on yield*", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const { value } = yield* Effect.succeed({ value: 1 });
</script>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "Destructure.svelte",
  });

  assertStringIncludes(result.code, `let value = $state<any>(undefined);`);
  assertMatch(
    result.code,
    /const __svelteEffectRuntime_value_\d+ = \(\) => Effect\.succeed\(\{ value: 1 \}\);/,
  );
  assertMatch(
    result.code,
    /let __svelteEffectRuntimeTemp_\d+: __svelteEffectRuntimeYielded<ReturnType<typeof __svelteEffectRuntime_value_\d+>> = \$state\(undefined as unknown as __svelteEffectRuntimeYielded<ReturnType<typeof __svelteEffectRuntime_value_\d+>>\);/,
  );
  assertMatch(
    result.code,
    /__svelteEffectRuntimeTemp_\d+ = yield\* __svelteEffectRuntime_value_\d+\(\);/,
  );
  assertMatch(
    result.code,
    /\(\{ value \} = __svelteEffectRuntimeTemp_\d+\);/,
  );
});

Deno.test("later declarations can depend on yielded values", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const count = yield* Effect.succeed(2);
  const doubled = count * 2;
</script>

<p>{count} / {doubled}</p>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "Derived.svelte",
  });

  assertMatch(
    result.code,
    /let count: __svelteEffectRuntimeYielded<ReturnType<typeof __svelteEffectRuntime_count_\d+>> = \$state\(undefined as unknown as __svelteEffectRuntimeYielded<ReturnType<typeof __svelteEffectRuntime_count_\d+>>\);/,
  );
  assertMatch(
    result.code,
    /let doubled: ReturnType<typeof __svelteEffectRuntime_doubled_\d+> = \$state\(undefined as unknown as ReturnType<typeof __svelteEffectRuntime_doubled_\d+>\);/,
  );
  assertMatch(
    result.code,
    /count = yield\* __svelteEffectRuntime_count_\d+\(\);\s+doubled = __svelteEffectRuntime_doubled_\d+\(\);/s,
  );
});

Deno.test("plain const Effect definitions stay hoisted at component scope", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const increment = Effect.gen(function* () {
    return 1;
  });
</script>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "HoistedEffect.svelte",
  });

  assertStringIncludes(
    result.code,
    `const increment = Effect.gen(function* () {`,
  );
  assertEquals(
    result.code.includes(`let increment = $state<any>(undefined);`),
    false,
  );
});

Deno.test("Effect.tryPromise declarations with nested async await stay hoisted", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";

  const pokemon = Effect.tryPromise({
    try: async () => {
      const response = await fetch("https://pokeapi.co/api/v2/pokemon/1");
      return await response.json();
    },
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error))
  }).pipe(
    Effect.map((data) => data.name)
  );
</script>

<p>{yield* pokemon}</p>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "TryPromiseHoist.svelte",
  });

  assertStringIncludes(result.code, `const pokemon = Effect.tryPromise({`);
  assertEquals(
    result.code.includes(`let pokemon = $state<any>(undefined);`),
    false,
  );
});

Deno.test("rewrites inline event handlers with yield* into runtime-backed callbacks", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";

  function increment() {
    return Effect.succeed(1);
  }
</script>

<button onclick={() => yield* increment()}>Increment</button>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "InlineEvent.svelte",
  });

  assertStringIncludes(
    result.code,
    `onclick={() => {`,
  );
  assertStringIncludes(
    result.code,
    `void __svelteEffectRuntimeMarkupRun(function* () {`,
  );
  assertStringIncludes(
    result.code,
    `return (yield* increment());`,
  );
});

Deno.test("markup rewrites do not choke on yield* inside <script effect>", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";

  let value = $state("");
  value = yield* Effect.succeed("ready");
</script>

<button onclick={() => yield* Effect.succeed("clicked")}>Click</button>
<p>{value}</p>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "ScriptAndMarkupYield.svelte",
  });

  assertStringIncludes(result.code, `value = yield* Effect.succeed("ready");`);
  assertStringIncludes(result.code, `onclick={() => {`);
  assertStringIncludes(
    result.code,
    `void __svelteEffectRuntimeMarkupRun(function* () {`,
  );
});

Deno.test("rewrites #if, #each, and #await markup expressions through markup helpers", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
</script>

{#if yield* Effect.succeed(true)}
  {#each yield* Effect.succeed([1, 2]) as item}
    <p>{yield* Effect.succeed(item)}</p>
  {/each}
{/if}

{#await yield* Effect.succeed(Promise.resolve("done")) then value}
  <span>{value}</span>
{/await}
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "MarkupBlocks.svelte",
  });

  assertStringIncludes(
    result.code,
    `{#if __svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `{#each __svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `<p>{__svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `{#await __svelteEffectRuntimeMarkupPromise(`,
  );
});

Deno.test("rewrites event directives and const tags through the markup AST pass", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";

  function increment() {
    return Effect.succeed(1);
  }
</script>

<button on:click={() => yield* increment()}>Increment</button>
{@const label = yield* Effect.succeed("ready")}
<p>{label}</p>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "DirectiveAndConst.svelte",
  });

  assertStringIncludes(result.code, `on:click={() => {`);
  assertStringIncludes(
    result.code,
    `{@const label = __svelteEffectRuntimeMarkupValue(`,
  );
});

Deno.test("rewrites key blocks and spread attributes through the markup AST pass", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
</script>

{#key yield* Effect.succeed("a")}
  <Widget {...(yield* Effect.succeed({ answer: 42 }))} />
{/key}
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "KeyAndSpread.svelte",
  });

  assertStringIncludes(
    result.code,
    `{#key __svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `{...__svelteEffectRuntimeMarkupValue(`,
  );
});

Deno.test("rewrites render tags through the markup AST pass", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
</script>

{@render yield* Effect.succeed(content())}

{#snippet content()}
  <p>ready</p>
{/snippet}
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "RenderTag.svelte",
  });

  assertStringIncludes(
    result.code,
    `{@render (__svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `function () {}))()}`,
  );
});

Deno.test("rewrites parenthesized yield render tags that still resolve to calls", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
</script>

{@render yield* (content())}
{@render (yield* content())}

{#snippet content()}
  <p>ready</p>
{/snippet}
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "RenderTagParenthesized.svelte",
  });

  assertStringIncludes(
    result.code,
    `{@render (__svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `function () {}))()}`,
  );
});

Deno.test("rejects render tags that do not resolve to calls after yield lowering", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
</script>

{@render yield* content}

{#snippet content()}
  <p>ready</p>
{/snippet}
`;

  await assertRejects(
    () =>
      preprocess(source, effectPreprocess(), {
        filename: "RenderTagInvalid.svelte",
      }),
    Error,
    `{@render ...} must still resolve to a call expression`,
  );
});

Deno.test("rewrites attach tags through the markup AST pass", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const attach = () => {};
</script>

<div {@attach yield* Effect.succeed(attach)}></div>
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "AttachTag.svelte",
  });

  assertStringIncludes(
    result.code,
    `{@attach __svelteEffectRuntimeMarkupValue(`,
  );
});

Deno.test("rewrites regex literal expressions through Babel boundary detection", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
</script>

<p>{yield* Effect.succeed(/}/.test("}"))}</p>

{#if yield* Effect.succeed(/}/.test("}"))}
  <p>shown</p>
{/if}

{@html yield* Effect.succeed(/}/.source)}
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "RegexBoundaries.svelte",
  });

  assertStringIncludes(
    result.code,
    `<p>{__svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `{#if __svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `{@html __svelteEffectRuntimeMarkupValue(`,
  );
});

Deno.test("rewrites #each and #await headers when regex literals contain keyword text", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
</script>

{#each yield* Effect.succeed(/ as /.source.split(" ")) as item}
  <p>{item}</p>
{/each}

{#await yield* Effect.succeed(Promise.resolve(/ then /.source)) then value}
  <p>{value}</p>
{/await}
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "KeywordRegexHeaders.svelte",
  });

  assertStringIncludes(
    result.code,
    `{#each __svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `{#await __svelteEffectRuntimeMarkupPromise(`,
  );
});

Deno.test("rejects debug tags that depend on yield in markup", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
</script>

{@debug yield* Effect.succeed(1)}
`;

  await assertRejects(
    () =>
      preprocess(source, effectPreprocess(), {
        filename: "DebugTag.svelte",
      }),
    Error,
    `{@debug ...} cannot depend on yield* in markup right now`,
  );
});

Deno.test("preserves TypeScript snippet parameters while rewriting markup", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const map = {
    intro: "one",
    api: "two",
  };
</script>

<p>{yield* Effect.succeed(1)}</p>

{#snippet card(title: string, value: keyof typeof map)}
  <button onclick={() => console.log(value)}>{title}</button>
{/snippet}
`;

  const result = await preprocess(source, effectPreprocess(), {
    filename: "TypedSnippet.svelte",
  });

  assertStringIncludes(
    result.code,
    `<p>{__svelteEffectRuntimeMarkupValue(`,
  );
  assertStringIncludes(
    result.code,
    `{#snippet card(title: string, value: keyof typeof map)}`,
  );
});
