import {
  assertEquals,
  assertNotMatch,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { createServer, normalizePath } from "vite";
import {
  transform_markup_effect,
  transform_script_effect,
  transform_svelte_effect,
} from "../../../modules/svelte-effect-runtime/src/runtime/transform.ts";
import {
  effect,
  rewrite_remote_client_exports,
} from "../../../modules/svelte-effect-runtime/src/vite.ts";
import {
  get_server_runtime_or_throw,
  reset_server_runtime,
  ServerRuntime,
} from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { RuntimeAlreadyInitializedError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { promise } from "../../../modules/svelte-effect-runtime/src/markup/promise.ts";
import { Context, Layer } from "effect";
import { compile, parse } from "svelte/compiler";

async function run_svelte_transform(
  plugin: ReturnType<typeof effect>[number],
  source: string,
  id: string,
  options?: { ssr?: boolean },
): Promise<{ code: string }> {
  const transform = plugin.transform;

  if (typeof transform === "function") {
    const result = await transform.call({} as never, source, id, options);

    if (!result || typeof result === "string") {
      throw new Error("svelte transform should return code output");
    }

    return result;
  }

  if (typeof transform === "object" && transform?.handler) {
    const result = await transform.handler(source, id, options);

    if (!result || typeof result === "string") {
      throw new Error("svelte transform should return code output");
    }

    return result;
  }

  throw new Error("svelte transform plugin should expose a transform hook");
}

async function collect_transform_warnings(
  plugin: ReturnType<typeof effect>[number],
  source: string,
  id: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const transform = plugin.transform;

  if (typeof transform !== "function") {
    throw new Error("guard plugin should expose a transform hook");
  }

  await transform.call(
    {
      warn(warning: string | { message?: string }) {
        warnings.push(
          typeof warning === "string"
            ? warning
            : warning.message ?? String(warning),
        );
      },
    } as never,
    source,
    id,
  );

  return warnings;
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

  assertStringIncludes(result.code, `Code.Markup.Promise`);
  assertStringIncludes(result.code, `Code.Markup.Run`);
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
  assertStringIncludes(result.code, `await get_dispatcher().promise({`);
  assertStringIncludes(result.code, `$state(await`);
  assertNotMatch(result.code, /\$effect\(\(\) =>/);
  if (result.code.includes(` effect>`)) {
    throw new Error("effect attribute should be removed before Svelte parses");
  }
});

Deno.test("direct svelte transform emits async rune output Svelte can compile", () => {
  const sources = [
    [
      `<script lang="ts" effect>`,
      `  const slug = "intro";`,
      `  const post = $derived(yield* GetPost(slug));`,
      `</script>`,
      `<h1>{post.title}</h1>`,
    ].join("\n"),
    [
      `<script lang="ts" effect>`,
      `  let post = $state(yield* GetPost("intro"));`,
      `</script>`,
      `<h1>{post.title}</h1>`,
    ].join("\n"),
    [
      `<script lang="ts" effect>`,
      `  let { value = yield* load() } = $props();`,
      `</script>`,
      `<p>{value}</p>`,
    ].join("\n"),
  ];

  for (const source of sources) {
    const transformed = transform_svelte_effect(source, "AsyncRunes.svelte");

    compile(transformed.code, {
      filename: "AsyncRunes.svelte",
      generate: "server",
      experimental: { async: true },
    });

    compile(transformed.code, {
      filename: "AsyncRunes.svelte",
      generate: "client",
      experimental: { async: true },
    });
  }
});

Deno.test("direct svelte transform accepts optional filename", () => {
  const source = `<p>{yield* loadValue()}</p>`;

  const result = transform_svelte_effect(source);

  assertStringIncludes(result.code, `Code.Markup.Promise`);
});

Deno.test("vite plugin keeps runtime package transformable in SSR builds", () => {
  const plugins = effect();
  const diagnostics_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:diagnostics"
  );
  const transform_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:svelte-transform"
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

  if (!transform_plugin || !transform_plugin.transform) {
    throw new Error("svelte transform plugin should expose a transform hook");
  }

  if (transform_plugin.enforce !== undefined) {
    throw new Error("svelte transform plugin should use normal Vite ordering");
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

Deno.test("vite diagnostics plugin warns for bare Effect.gen event handlers", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={Effect.gen}>save</button>`,
  ].join("\n");

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "onclick={Effect.gen}");
  assertStringIncludes(warnings[0], "Effect.gen is a constructor");
  assertStringIncludes(
    warnings[0],
    "onclick={yield* Effect.gen(function* () { ... })}",
  );
});

Deno.test("vite diagnostics plugin ignores yielded Effect handlers", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={yield* Effect.gen(function* () {})}>save</button>`,
  ].join("\n");

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings, []);
});

Deno.test("vite diagnostics plugin warns for directive event Effect callbacks", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button on:click={() => Effect.sync(() => save())}>save</button>`,
  ].join("\n");

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "on:click");
  assertStringIncludes(warnings[0], "Effect.sync");
  assertStringIncludes(warnings[0], "returns an Effect but does not run it");
});

Deno.test("vite diagnostics plugin warns for hidden event callback yield", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={() => yield* Effect.gen(function* () {})}>save</button>`,
  ].join("\n");

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "yield* hidden inside an event callback");
  assertStringIncludes(warnings[0], "event attribute boundary");
});

Deno.test("vite diagnostics plugin warns for explicit Effect runners", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={() => Effect.runPromise(Effect.gen(function* () {}))}>run</button>`,
  ].join("\n");

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "explicit Effect runner");
  assertStringIncludes(warnings[0], "bypass SER cancellation");
});

Deno.test("vite diagnostics plugin warns for non-event Effect attributes", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<input disabled={Effect.sync(() => true)} />`,
    `<p class:active={Effect.succeed(true)}>active</p>`,
  ].join("\n");

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 2);
  assertStringIncludes(warnings[0], "attribute value");
  assertStringIncludes(warnings[0], "disabled={yield* Effect.sync");
  assertStringIncludes(warnings[1], "class:active={yield* Effect.succeed");
});

Deno.test("vite diagnostics plugin warns for sync markup Effect expressions", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `{@const status = Effect.succeed("ready")}`,
    `{#if Effect.succeed(true)}ready{/if}`,
    `<p>{Effect.gen(function* () {})}</p>`,
  ].join("\n");

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 3);
  assertStringIncludes(warnings[0], "will produce an Effect value");
  assertStringIncludes(warnings[0], "@const status = Effect.succeed");
  assertStringIncludes(warnings[1], "#if Effect.succeed");
  assertStringIncludes(warnings[2], "Effect.gen");
});

Deno.test("vite diagnostics plugin recognizes Effect import aliases", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect as E } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={E.gen}>save</button>`,
  ].join("\n");

  await diagnostics_plugin.transform.call(
    make_warning_context(warnings),
    source,
    "src/routes/+page.svelte",
  );

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "onclick={E.gen}");
  assertStringIncludes(warnings[0], "E.gen is a constructor");
});

Deno.test("vite diagnostics plugin deduplicates repeated warnings", async () => {
  const warnings: string[] = [];
  const diagnostics_plugin = get_diagnostics_plugin();
  const source = [
    `<script lang="ts">`,
    `  import { Effect } from "effect";`,
    `</script>`,
    ``,
    `<button onclick={Effect.gen}>save</button>`,
  ].join("\n");

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

Deno.test("vite transform plugin logs possible pre transform plugin conflicts", () => {
  const plugins = effect();
  const infos: string[] = [];
  const transform_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:svelte-transform"
  );

  if (
    !transform_plugin || typeof transform_plugin.configResolved !== "function"
  ) {
    throw new Error("svelte transform plugin should expose a config hook");
  }

  transform_plugin.configResolved?.({
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
    logger: {
      info(message: string) {
        infos.push(message);
      },
    },
  } as never);

  assertEquals(infos.length, 1);
  assertStringIncludes(infos[0], "[svelte-effect-runtime]");
  assertStringIncludes(
    infos[0],
    "Svelte Effect Runtime noticed possible Vite plugin ordering conflicts.",
  );
  assertStringIncludes(infos[0], "  - pre-parser");
  assertStringIncludes(infos[0], "  - wuchale");
  assertStringIncludes(infos[0], "<script effect>");
  assertStringIncludes(infos[0], "yield* in components");
  assertNotMatch(infos[0], /remove/i);
});

Deno.test("vite plugins do not force pre transform ordering", () => {
  const plugins = effect();
  const pre_plugins = plugins.filter((plugin) => plugin.enforce === "pre");

  assertEquals(pre_plugins, []);
});

Deno.test("vite plugin warns when SER files use reserved generated helper names", async () => {
  const plugins = effect();
  const guard_index = plugins.findIndex((candidate) =>
    candidate.name === "svelte-effect-runtime:reserved-helper-guard"
  );
  const transform_index = plugins.findIndex((candidate) =>
    candidate.name === "svelte-effect-runtime:svelte-transform"
  );
  const plugin = plugins[guard_index];

  if (!plugin) {
    throw new Error("reserved helper guard plugin should exist");
  }

  if (guard_index >= transform_index) {
    throw new Error("reserved helper guard should run before the transform");
  }

  const source = [
    `<script>`,
    `  const Dispatcher = "local dispatcher";`,
    `  function loadValue() {}`,
    `</script>`,
    `{#each [1] as Code}`,
    `  <p>{Code}: {yield* loadValue()}</p>`,
    `{/each}`,
  ].join("\n");

  const warnings = await collect_transform_warnings(
    plugin,
    source,
    "C:/src/routes/Test.svelte",
  );

  assertEquals(warnings.length, 1);
  assertStringIncludes(
    warnings[0],
    "`Dispatcher` and `Code` are reserved for generated markup helpers",
  );
});

Deno.test("vite plugin reserved helper guard ignores ordinary Svelte files", async () => {
  const plugin = effect().find((candidate) =>
    candidate.name === "svelte-effect-runtime:reserved-helper-guard"
  );

  if (!plugin) {
    throw new Error("reserved helper guard plugin should exist");
  }

  const source = [
    `<script>`,
    `  const Dispatcher = "plain";`,
    `  const Code = "plain";`,
    `</script>`,
    `<p>{Code}</p>`,
  ].join("\n");

  const warnings = await collect_transform_warnings(
    plugin,
    source,
    "C:/src/routes/Test.svelte",
  );

  assertEquals(warnings, []);
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
  assertStringIncludes(result.code, `await get_dispatcher().promise({`);
  assertStringIncludes(result.code, `$state(await`);
  assertStringIncludes(result.code, `Code.Markup.Run`);
  assertNotMatch(result.code, /\$effect\(\(\) =>/);

  parse(result.code, { filename: "Test.svelte" });

  if (/script[^>]*\beffect\b/.test(result.code)) {
    throw new Error("effect attribute should be removed");
  }

  if (result.code.includes(`onclick={yield*`)) {
    throw new Error("markup yield should be lowered");
  }
});

Deno.test("vite plugin emits client and server promises", async () => {
  const plugins = effect();
  const plugin = plugins.find((candidate) =>
    candidate.name === "svelte-effect-runtime:svelte-transform"
  );

  if (!plugin) {
    throw new Error("svelte transform plugin should exist");
  }

  const source = `<p>{yield* loadValue()}</p>`;

  const client = await run_svelte_transform(
    plugin,
    source,
    "C:/src/routes/Test.svelte",
    { ssr: false },
  );
  const server = await run_svelte_transform(
    plugin,
    source,
    "C:/src/routes/Test.svelte",
    { ssr: true },
  );

  assertStringIncludes(
    client.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(
    server.code,
    `await Dispatcher.emit({ type: Code.Markup.Promise`,
  );
  assertStringIncludes(server.code, `ssr_fallback: undefined`);

  if (client.code.includes(`Code.Markup.Value`)) {
    throw new Error("client transform should not emit value reads");
  }

  if (client.code.includes(`ssr_fallback`)) {
    throw new Error("client transform should not emit SSR fallbacks");
  }
});

Deno.test("generated promise helpers use ServerRuntime services during SSR", async () => {
  reset_server_runtime();

  const ReproService = Context.Service<{ readonly value: string }>(
    "ReproService",
  );

  try {
    ServerRuntime.make(
      Layer.succeed(ReproService, { value: "server-service" }),
    );

    const result = await promise("server-service", [], function* () {
      return yield* ReproService;
    });

    assertEquals(result.value, "server-service");
  } finally {
    reset_server_runtime();
  }
});

Deno.test("ServerRuntime.make survives Vite dev SSR hook reloads", async () => {
  const temp_dir = await Deno.makeTempDir({ prefix: "ser-hmr-repro-" });
  const source_root = normalizePath(
    `${Deno.cwd()}/../../modules/svelte-effect-runtime/src`,
  );
  const hook_path = `${temp_dir}/src/hooks.server.ts`;

  await Deno.mkdir(`${temp_dir}/src`, { recursive: true });
  await Deno.writeTextFile(
    hook_path,
    [
      `import { ServerRuntime } from "${source_root}/server/runtime.ts";`,
      ``,
      `export const init = () => {`,
      `  return ServerRuntime.make();`,
      `};`,
    ].join("\n"),
  );

  const server = await createServer({
    root: temp_dir,
    logLevel: "silent",
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    resolve: {
      alias: [
        { find: /^\$\/(.*)$/, replacement: `${source_root}/$1` },
      ],
    },
  });

  try {
    const first = await server.ssrLoadModule("/src/hooks.server.ts");
    const first_runtime = first.init();
    const second = await server.ssrLoadModule("/src/hooks.server.ts?hmr=1");
    const second_runtime = second.init();

    if (first_runtime === second_runtime) {
      throw new Error("HMR reload should rebuild the server runtime");
    }
  } finally {
    await server.close();
    await Deno.remove(temp_dir, { recursive: true });
  }
});

Deno.test("ServerRuntime.make throws when the server runtime already exists", () => {
  reset_server_runtime();

  try {
    ServerRuntime.make();

    const error = assertThrows(
      () => ServerRuntime.make(),
      RuntimeAlreadyInitializedError,
      "ServerRuntime.make(...) cannot be called",
    );

    assertEquals(error.name, "RuntimeAlreadyInitializedError");
  } finally {
    reset_server_runtime();
  }
});

Deno.test("ServerRuntime.make throws after lazy server runtime creation", () => {
  reset_server_runtime();

  try {
    get_server_runtime_or_throw();

    const error = assertThrows(
      () => ServerRuntime.make(),
      RuntimeAlreadyInitializedError,
      "runtime has already been initialized",
    );

    assertEquals(error.name, "RuntimeAlreadyInitializedError");
  } finally {
    reset_server_runtime();
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

function get_diagnostics_plugin(): {
  transform: (
    this: { warn(warning: string | { message?: string }): void },
    code: string,
    id: string,
  ) => unknown | Promise<unknown>;
} {
  const plugins = effect();
  const diagnostics_plugin = plugins.find((plugin) =>
    plugin.name === "svelte-effect-runtime:diagnostics"
  );

  if (
    !diagnostics_plugin || typeof diagnostics_plugin.transform !== "function"
  ) {
    throw new Error("diagnostics plugin should expose a transform hook");
  }

  return diagnostics_plugin as {
    transform: (
      this: { warn(warning: string | { message?: string }): void },
      code: string,
      id: string,
    ) => unknown | Promise<unknown>;
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
  assertEquals(
    package_manifest.exports["./grammars"],
    undefined,
  );
  assertEquals(
    package_manifest.dependencies["svelte-effect-runtime-grammars"],
    undefined,
  );
  assertEquals(package_manifest.exports["./runtime/preprocess"], undefined);

  assertEquals(deno_manifest.exports["./vite"], "./src/vite.ts");
  assertEquals(
    deno_manifest.exports["./runtime/transform"],
    "./src/runtime/transform.ts",
  );
  assertEquals(
    deno_manifest.exports["./grammars"],
    undefined,
  );
  assertEquals(
    deno_manifest.imports["svelte-effect-runtime-grammars"],
    undefined,
  );
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
