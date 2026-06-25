import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  transform_markup_effect,
  transform_script_effect,
  transform_svelte_effect,
} from "../../../modules/svelte-effect-runtime/src/runtime/transform.ts";
import {
  effect,
  rewrite_remote_client_exports,
} from "../../../modules/svelte-effect-runtime/src/vite.ts";
import { ServerRuntime } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { promise } from "../../../modules/svelte-effect-runtime/src/markup/promise.ts";
import { Context, Layer } from "effect";
import { parse } from "svelte/compiler";

async function run_svelte_transform(
  plugin: ReturnType<typeof effect>[number],
  source: string,
  id: string,
): Promise<{ code: string }> {
  const transform = plugin.transform;

  if (typeof transform === "function") {
    const result = await transform.call({} as never, source, id);

    if (!result || typeof result === "string") {
      throw new Error("svelte transform should return code output");
    }

    return result;
  }

  if (typeof transform === "object" && transform?.handler) {
    const result = await transform.handler(source, id);

    if (!result || typeof result === "string") {
      throw new Error("svelte transform should return code output");
    }

    return result;
  }

  throw new Error("svelte transform plugin should expose a transform hook");
}

/** Full pipeline. */

Deno.test("full pipeline: script lowered output feeds into markup pass", () => {
  const script_content = `
    let user = $state();
    const __SER___loadUser = $state();
    const __SER___dispatcher = get_dispatcher();

    onMount(() => {
      const __SER___program = Effect.gen(function* () {
        __SER___loadUser = yield* loadUser();
        user = __SER___loadUser;
      });
      const __SER___cleanup = __SER___dispatcher.fork(__SER___program);
      return __SER___cleanup;
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

  assertStringIncludes(result.code, `__SER___markup_value`);
  assertStringIncludes(result.code, `__SER___markup_run`);
  assertStringIncludes(result.code, `renderDate`);
  assertStringIncludes(result.code, `hasAccess`);
  assertStringIncludes(result.code, `handleClick`);
  assertStringIncludes(result.code, `{#if`);
  if (!result.has_yield) throw new Error("markup pass should detect yield*");
});

Deno.test("full pipeline: script and markup transforms agree on has_yield", () => {
  const script = `
    const x = $state(yield* compute());
  `.trim();

  const script_result = transform_script_effect(script, "Test.svelte");
  assertStringIncludes(script_result.code, `__SER___`);

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

Deno.test("direct svelte transform lowers script effect and removes effect attribute", () => {
  const source = [
    `<script lang="ts" effect>`,
    `  let value = $state(yield* loadValue());`,
    `</script>`,
    `<p>{value}</p>`,
  ].join("\n");

  const result = transform_svelte_effect(source, "Test.svelte");

  assertStringIncludes(result.code, `<script lang="ts">`);
  assertStringIncludes(result.code, `__SER___program`);
  if (result.code.includes(` effect>`)) {
    throw new Error("effect attribute should be removed before Svelte parses");
  }
});

Deno.test("direct svelte transform accepts optional filename", () => {
  const source = `<p>{yield* loadValue()}</p>`;

  const result = transform_svelte_effect(source);

  assertStringIncludes(result.code, `__SER___markup_value`);
});

Deno.test("vite plugin keeps runtime package transformable in SSR builds", () => {
  const plugins = effect();
  const transform_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:svelte-transform"
  );
  const server_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:server-imports"
  );
  const client_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:remote-client"
  );

  if (!transform_plugin || !transform_plugin.transform) {
    throw new Error("svelte transform plugin should expose a transform hook");
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

Deno.test("vite plugin lowers svelte yield through its transform hook", async () => {
  const plugins = effect();
  const plugin = plugins.find((candidate) =>
    candidate.name === "svelte-effect-runtime:svelte-transform"
  );

  if (!plugin) {
    throw new Error("svelte transform plugin should exist");
  }

  const source = [
    `<script effect lang="ts">`,
    `  let value = $state(yield* loadValue());`,
    `</script>`,
    ``,
    `<button onclick={yield* save(value)}>Save</button>`,
  ].join("\n");

  const result = await run_svelte_transform(
    plugin,
    source,
    "C:/src/routes/Test.svelte",
  );

  assertStringIncludes(result.code, `<script lang="ts">`);
  assertStringIncludes(result.code, `__SER___program`);
  assertStringIncludes(result.code, `__SER___markup_run`);

  parse(result.code, { filename: "Test.svelte" });

  if (/script[^>]*\beffect\b/.test(result.code)) {
    throw new Error("effect attribute should be removed");
  }

  if (result.code.includes(`onclick={yield*`)) {
    throw new Error("markup yield should be lowered");
  }
});

Deno.test("generated promise helpers use ServerRuntime services during SSR", async () => {
  const ReproService = Context.Service<{ readonly value: string }>(
    "ReproService",
  );

  ServerRuntime.make(
    Layer.succeed(ReproService, { value: "server-service" }),
  );

  const result = await promise("server-service", [], function* () {
    return yield* ReproService;
  });

  assertEquals(result.value, "server-service");

  ServerRuntime.make();
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

Deno.test("package manifests expose vite and transform entrypoints", async () => {
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
  assertEquals(package_manifest.exports["./runtime/transform"], {
    types: "./.dist/runtime/transform.d.ts",
    default: "./.dist/runtime/transform.js",
  });
  assertEquals(package_manifest.exports["./grammars"], {
    types: "./.dist/grammars.d.ts",
    import: "./.dist/grammars.js",
    default: "./.dist/grammars.js",
  });
  assertEquals(package_manifest.exports["./runtime/preprocess"], undefined);

  assertEquals(deno_manifest.exports["./vite"], "./src/vite.ts");
  assertEquals(
    deno_manifest.exports["./runtime/transform"],
    "./src/runtime/transform.ts",
  );
  assertEquals(deno_manifest.exports["./grammars"], "./src/grammars.ts");
  assertEquals(deno_manifest.exports["./runtime/preprocess"], undefined);
});

Deno.test("vite entrypoint defers svelte transformer import until transform hook", async () => {
  const source = await Deno.readTextFile(
    "../../modules/svelte-effect-runtime/src/vite.ts",
  );
  const static_import_pattern =
    /^import\s+.*["']\.\/runtime\/transform\.ts["'];/m;

  if (static_import_pattern.test(source)) {
    throw new Error("vite entrypoint should not statically import transformer");
  }

  assertStringIncludes(source, `await import(`);
  assertStringIncludes(source, `"./runtime/transform.ts"`);
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
    `export const get_post = create_remote_query_adapter(__remote.query('abc/get_post'), __SER___decode_payload);`,
  );
  assertStringIncludes(
    result,
    `export const get_post_batch = create_remote_query_adapter(__remote.query_batch('abc/get_post_batch'), __SER___decode_payload);`,
  );
  assertStringIncludes(
    result,
    `export const get_clock = create_remote_live_query_adapter(__remote.query_live('abc/get_clock'), __SER___decode_payload);`,
  );
  assertStringIncludes(
    result,
    `export const save_post = create_remote_command_adapter(__remote.command('abc/save_post'), __SER___decode_payload);`,
  );
  assertStringIncludes(
    result,
    `export const create_post = create_remote_form_adapter(__remote.form('abc/create_post'), __SER___decode_payload, __SER___remote_base);`,
  );

  if (
    result.indexOf(`const __SER___remote_base`) >
      result.indexOf(`export const create_post`)
  ) {
    throw new Error("remote helpers must be declared before wrapped exports");
  }
});
