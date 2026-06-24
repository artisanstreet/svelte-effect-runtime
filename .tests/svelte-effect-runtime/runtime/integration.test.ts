import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  preprocess,
  transform_markup_effect,
  transform_script_effect,
} from "../../../modules/svelte-effect-runtime/src/runtime/preprocess.ts";
import {
  effect,
  rewrite_remote_client_exports,
} from "../../../modules/svelte-effect-runtime/src/vite.ts";
import { VitePreTransformPluginConflictError } from "../../../modules/svelte-effect-runtime/src/errors.ts";

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
  <button on:click={yield* handleClick(event)}>go</button>
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
  assertStringIncludes(script_result.code, `__SER__`);

  const full =
    `<script>\n${script_result.code}\n</script>\n\n<p>{yield* getValue()}</p>`;

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
  if (markup_result.has_yield) {
    throw new Error("markup should not detect script yield*");
  }
});

Deno.test("full pipeline: markup-only passes through script unchanged", () => {
  const markup = `<p>{yield* getValue()}</p>`;

  const result = transform_script_effect(markup, "Test.svelte");
  if (result.code !== markup) throw new Error("expected identity output");
});

Deno.test("preprocess hook only lowers script effect and removes effect attribute", () => {
  const group = preprocess();
  const source = [
    `<script lang="ts" effect>`,
    `  let value = $state(yield* loadValue());`,
    `</script>`,
    `<p>{value}</p>`,
  ].join("\n");

  const result = group.markup({ content: source, filename: "Test.svelte" });

  assertStringIncludes(result.code, `<script lang="ts">`);
  assertStringIncludes(result.code, `__SER__program`);
  if (result.code.includes(` effect>`)) {
    throw new Error("effect attribute should be removed before Svelte parses");
  }
});

Deno.test("preprocess hook accepts optional filename", () => {
  const group = preprocess();
  const source = `<p>{yield* loadValue()}</p>`;

  const result = group.markup({ content: source });

  assertStringIncludes(result.code, `__ser_markup_value`);
});

Deno.test("vite plugin keeps runtime package transformable in SSR builds", () => {
  const plugins = effect();
  const diagnostics_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:diagnostics"
  );
  const component_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:component-syntax"
  );
  const server_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:server-imports"
  );
  const client_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:remote-client"
  );

  if (!diagnostics_plugin || plugins[0] !== diagnostics_plugin) {
    throw new Error("diagnostics plugin should run before transform plugins");
  }

  if (!component_plugin || component_plugin.enforce !== undefined) {
    throw new Error("component syntax plugin should use normal Vite ordering");
  }

  if (!server_plugin || typeof server_plugin.config !== "function") {
    throw new Error("server rewrite plugin should expose a config hook");
  }

  if (!client_plugin || typeof client_plugin.config !== "function") {
    throw new Error("remote client plugin should expose a config hook");
  }

  const server_config = server_plugin.config(
    {},
    {
      command: "build",
      isPreview: false,
      isSsrBuild: true,
      mode: "production",
    },
  );
  const client_config = client_plugin.config(
    {},
    {
      command: "build",
      isPreview: false,
      isSsrBuild: true,
      mode: "production",
    },
  );

  assertEquals(server_config, {
    optimizeDeps: { exclude: ["svelte-effect-runtime"] },
  });
  assertEquals(client_config, {
    ssr: { noExternal: ["svelte-effect-runtime"] },
  });

  const resolved_config = {
    ssr: {
      noExternal: ["svelte"],
    },
  };

  client_plugin.configResolved?.(resolved_config as never);

  assertEquals(resolved_config.ssr.noExternal, [
    "svelte",
    "svelte-effect-runtime",
  ]);
});

Deno.test("vite diagnostics plugin warns for Effect event handlers without yield", async () => {
  const warnings: string[] = [];
  const plugins = effect();
  const diagnostics_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:diagnostics"
  );
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={Effect.gen}>save</button>`,
  ].join("\n");

  if (
    !diagnostics_plugin || typeof diagnostics_plugin.transform !== "function"
  ) {
    throw new Error("diagnostics plugin should expose a transform hook");
  }

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "onclick={Effect.gen}");
  assertStringIncludes(warnings[0], "yield* at the beginning");
  assertStringIncludes(warnings[0], "onclick={yield* Effect.gen}");
});

Deno.test("vite diagnostics plugin ignores yielded and explicitly run Effect event handlers", async () => {
  const warnings: string[] = [];
  const plugins = effect();
  const diagnostics_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:diagnostics"
  );
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={yield* Effect.gen(function* () {})}>save</button>`,
    `<button onclick={() => Effect.runPromise(Effect.gen(function* () {}))}>run</button>`,
    `<p>{Effect.gen(function* () {})}</p>`,
  ].join("\n");

  if (
    !diagnostics_plugin || typeof diagnostics_plugin.transform !== "function"
  ) {
    throw new Error("diagnostics plugin should expose a transform hook");
  }

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings, []);
});

Deno.test("vite diagnostics plugin warns for directive event Effect callbacks", async () => {
  const warnings: string[] = [];
  const plugins = effect();
  const diagnostics_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:diagnostics"
  );
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button on:click={() => Effect.sync(() => save())}>save</button>`,
  ].join("\n");

  if (
    !diagnostics_plugin || typeof diagnostics_plugin.transform !== "function"
  ) {
    throw new Error("diagnostics plugin should expose a transform hook");
  }

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "on:click");
  assertStringIncludes(warnings[0], "Effect.sync");
});

Deno.test("vite diagnostics plugin deduplicates repeated warnings", async () => {
  const warnings: string[] = [];
  const plugins = effect();
  const diagnostics_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:diagnostics"
  );
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={Effect.gen}>save</button>`,
  ].join("\n");

  if (
    !diagnostics_plugin || typeof diagnostics_plugin.transform !== "function"
  ) {
    throw new Error("diagnostics plugin should expose a transform hook");
  }

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );
  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 1);
});

Deno.test("vite component plugin errors for conflicting pre transform plugins", () => {
  const plugins = effect();
  const component_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:component-syntax"
  );

  if (
    !component_plugin || typeof component_plugin.configResolved !== "function"
  ) {
    throw new Error("component syntax plugin should expose a config hook");
  }

  const error = assertThrows(
    () =>
      component_plugin.configResolved?.({
        plugins: [
          ...plugins,
          {
            name: "vite-plugin-svelte:preprocess",
            enforce: "pre",
            transform() {
              return undefined;
            },
          },
          {
            name: "pre-parser",
            enforce: "pre",
            transform() {
              return undefined;
            },
          },
          {
            name: "wuchale",
            transform: {
              order: "pre",
              handler() {
                return undefined;
              },
            },
          },
        ],
      } as never),
    VitePreTransformPluginConflictError,
  );

  assertEquals(error.plugin_names, ["pre-parser", "wuchale"]);
  assertStringIncludes(error.message, "pre-parser");
  assertStringIncludes(error.message, "wuchale");
  assertStringIncludes(error.message, "transform.order");
  assertStringIncludes(error.message, "yield");
});

Deno.test("vite component plugin lowers script effect before Svelte compile", async () => {
  const plugins = effect();
  const component_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:component-syntax"
  );
  const source = [
    `<script effect lang="ts">`,
    `  const value = yield* loadValue();`,
    `</script>`,
    ``,
    `<p>{value}</p>`,
  ].join("\n");

  if (!component_plugin || typeof component_plugin.transform !== "function") {
    throw new Error("component syntax plugin should expose a transform hook");
  }

  const result = await component_plugin.transform(
    source,
    "src/routes/+page.svelte",
  );

  if (!result || typeof result === "string") {
    throw new Error("component syntax plugin should return transformed code");
  }

  assertStringIncludes(result.code, `<script lang="ts">`);
  assertStringIncludes(result.code, `__SER__program`);

  if (result.code.includes(`<script effect`)) {
    throw new Error("effect attribute should be removed before Svelte compile");
  }
});

function make_warning_context(warnings: string[]): {
  warn(warning: string | { message?: string }): void;
} {
  return {
    warn(warning: string | { message?: string }) {
      warnings.push(
        typeof warning === "string" ? warning : warning.message ?? "",
      );
    },
  };
}

Deno.test("root entry exposes server helpers for rewritten server imports", async () => {
  const root = await import(
    "../../../modules/svelte-effect-runtime/src/mod.ts"
  );

  assertEquals(typeof root.ServerRuntime.make, "function");
  assertEquals(typeof root.Query, "function");
  assertEquals(typeof root.Query.batch, "function");
  assertEquals(typeof root.Query.live, "function");
  assertEquals(typeof root.Command, "function");
  assertEquals(typeof root.Form, "function");
  assertEquals(typeof root.Prerender, "function");
  assertEquals(typeof root.get_server_runtime_or_throw, "function");
  assertEquals(typeof root.RequestEvent, "function");
});

Deno.test("root preprocess lazily delegates to runtime preprocess", async () => {
  const root = await import(
    "../../../modules/svelte-effect-runtime/src/mod.ts"
  );
  const group = root.preprocess();
  const result = await group.markup({
    content: `<p>{yield* loadValue()}</p>`,
    filename: "Test.svelte",
  });

  assertStringIncludes(result.code, `__ser_markup_value`);
  assertEquals(group.name, "svelte-effect-runtime");
});

Deno.test("root server-only exports throw before Vite rewrites imports", async () => {
  const root = await import(
    "../../../modules/svelte-effect-runtime/src/mod.ts"
  );
  const exports = [
    ["ServerRuntime", () => root.ServerRuntime.make()],
    ["Query", () => root.Query()],
    ["Query.batch", () => root.Query.batch()],
    ["Query.live", () => root.Query.live()],
    ["Command", () => root.Command()],
    ["Error", () => root.Error(500, "boom")],
    ["Form", () => root.Form()],
    ["Prerender", () => root.Prerender()],
    ["Redirect", () => root.Redirect(303, "/done")],
    ["RequestEvent", () => root.RequestEvent()],
    ["get_server_runtime_or_throw", () => root.get_server_runtime_or_throw()],
  ] as const;

  for (const [name, call] of exports) {
    const error = assertThrows(call, Error);

    assertStringIncludes(error.message, name);
    assertStringIncludes(error.message, "Vite plugin");
  }
});

Deno.test("package manifests expose vite entrypoint", async () => {
  const package_manifest = JSON.parse(
    await Deno.readTextFile(
      "../../modules/svelte-effect-runtime/package.json",
    ),
  );
  const deno_manifest = JSON.parse(
    await Deno.readTextFile(
      "../../modules/svelte-effect-runtime/deno.json",
    ),
  );

  assertEquals(package_manifest.exports["./vite"], {
    types: "./.dist/vite.d.ts",
    default: "./.dist/vite.js",
  });
  assertEquals(deno_manifest.exports["./vite"], "./src/vite.ts");
});

Deno.test("vite remote client wrapper preserves native SvelteKit remote module", () => {
  const source = [
    `import * as __remote from '__sveltekit/remote';`,
    ``,
    `export const get_post = __remote.query('abc/get_post');`,
    `export const get_post_batch = __remote.query_batch('abc/get_post_batch');`,
    `export const get_clock = __remote.query_live('abc/get_clock');`,
    `export const save_post = __remote.command('abc/save_post');`,
    `export const create_post = __remote.form('abc/create_post');`,
  ].join("\n");

  const result = rewrite_remote_client_exports(source);

  assertStringIncludes(result, `from '__sveltekit/remote';`);
  assertStringIncludes(result, `create_remote_query_adapter`);
  assertStringIncludes(result, `create_remote_live_query_adapter`);
  assertStringIncludes(result, `create_remote_command_adapter`);
  assertStringIncludes(result, `create_remote_form_adapter`);
  assertStringIncludes(
    result,
    `export const get_post = create_remote_query_adapter(__remote.query('abc/get_post'), __ser_decode_payload);`,
  );
  assertStringIncludes(
    result,
    `export const get_post_batch = create_remote_query_adapter(__remote.query_batch('abc/get_post_batch'), __ser_decode_payload);`,
  );
  assertStringIncludes(
    result,
    `export const get_clock = create_remote_live_query_adapter(__remote.query_live('abc/get_clock'), __ser_decode_payload);`,
  );
  assertStringIncludes(
    result,
    `export const save_post = create_remote_command_adapter(__remote.command('abc/save_post'), __ser_decode_payload);`,
  );
  assertStringIncludes(
    result,
    `export const create_post = create_remote_form_adapter(__remote.form('abc/create_post'), __ser_decode_payload, __ser_remote_base);`,
  );

  if (
    result.indexOf(`const __ser_remote_base`) >
      result.indexOf(`export const create_post`)
  ) {
    throw new Error("remote helpers must be declared before wrapped exports");
  }
});
