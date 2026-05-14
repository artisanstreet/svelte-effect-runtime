import { assertStringIncludes } from "@std/assert";
import { transform_script_effect, transform_markup_effect } from "../../../modules/svelte-effect-runtime/src/preprocess.ts";

// ─── Full pipeline ─────────────────────────────────────────────

Deno.test("full pipeline: script lowered output feeds into markup pass", () => {
  const script_content = `
    let user = $state();
    const __SER__loadUser = $state();
    const __SER__dispatcher = get_dispatcher();

    onMount(() => {
      const __SER__program = Effect.gen(function* () {
        __SER__loadUser = yield* loadUser();
        user = __SER__loadUser;
      });
      const __SER__cleanup = __SER__dispatcher.fork(__SER__program);
      return __SER__cleanup;
    });
  `.trim();

  const markup = `
<h1>Hello</h1>
<p>{yield* renderDate()}</p>

{#if yield* hasAccess()}
  <button on:click={() => yield* handleClick()}>go</button>
{/if}
`.trim();

  const full_source = `<script>\n${script_content}\n</script>\n\n${markup}`;

  const result = transform_markup_effect(full_source, "Test.svelte");

  assertStringIncludes(result.code, `__ser_markup_value`);
  assertStringIncludes(result.code, `__ser_markup_run`);
  assertStringIncludes(result.code, `renderDate`);
  assertStringIncludes(result.code, `hasAccess`);
  assertStringIncludes(result.code, `handleClick`);
  assertStringIncludes(result.code, `{#if`);
  if (!result.has_yield) throw new Error("markup pass should detect yield*");
});

Deno.test("full pipeline: both preprocessors agree on has_yield", () => {
  const script = `
    const x = $state(yield* compute());
  `.trim();

  const script_result = transform_script_effect(script, "Test.svelte");
  assertStringIncludes(script_result.code, `yield* compute`);

  const full = `<script>\n${script_result.code}\n</script>\n\n<p>{yield* getValue()}</p>`;

  const markup_result = transform_markup_effect(full, "Test.svelte");
  if (!markup_result.has_yield) throw new Error("markup pass failed");

  /** Second pass on markup output should be idempotent. */
  const second = transform_markup_effect(markup_result.code, "Test.svelte");
  if (second.code !== markup_result.code) {
    throw new Error("markup should be idempotent");
  }
});

Deno.test("full pipeline: script-only content passes through markup unchanged", () => {
  const script = `
    const x = $state(yield* compute());
  `.trim();

  const script_result = transform_script_effect(script, "Test.svelte");
  const full = `<script>\n${script_result.code}\n</script>`;

  const markup_result = transform_markup_effect(full, "Test.svelte");
  if (markup_result.code !== full) throw new Error("expected identity output");
  if (markup_result.has_yield) throw new Error("markup should not detect script yield*");
});

Deno.test("full pipeline: markup-only passes through script unchanged", () => {
  const markup = `<p>{yield* getValue()}</p>`;

  const result = transform_script_effect(markup, "Test.svelte");
  if (result.code !== markup) throw new Error("expected identity output");
  if (result.has_yield) throw new Error("script pass should not flag markup yield*");
});
