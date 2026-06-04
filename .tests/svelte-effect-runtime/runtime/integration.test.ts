import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  preprocess,
  transform_markup_effect,
  transform_script_effect,
} from "../../../modules/svelte-effect-runtime/src/runtime/preprocess.ts";
import {
  effect,
  rewrite_remote_client_exports,
} from "../../../modules/svelte-effect-runtime/src/vite.ts";

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
  const server_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:server-imports"
  );
  const client_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:remote-client"
  );

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
