import {
	transform_markup_effect,
	transform_script_effect,
	transform_svelte_effect,
} from "../../../modules/svelte-effect-runtime/src/runtime/transform.ts";
import {
	get_server_runtime_or_throw,
	reset_server_runtime,
	ServerRuntime,
} from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import {
	effect,
	rewrite_remote_client_exports,
} from "../../../modules/svelte-effect-runtime/src/compiler.ts";
import {
	assert_equals,
	assert_rejects,
	assert_throws,
	assert_not_match,
	assert_string_includes,
} from "../unit/helpers/assert.ts";
import { RuntimeAlreadyInitializedError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { promise } from "../../../modules/svelte-effect-runtime/src/markup/promise.ts";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, normalizePath } from "vite";
import { compile, parse } from "svelte/compiler";
import { fileURLToPath } from "node:url";
import { Context, Layer } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

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

async function run_server_import_transform(source: string, id: string): Promise<string> {
	const plugin = effect().find(
		(candidate) => candidate.name === "svelte-effect-runtime:server-imports",
	);

	if (!plugin || typeof plugin.transform !== "function") {
		throw new Error("server rewrite plugin should expose a transform hook");
	}

	const result = await plugin.transform.call({} as never, source, id);

	if (!result) {
		return source;
	}

	if (typeof result === "string") {
		return result;
	}

	return result.code;
}

/** Full pipeline. */

test("full pipeline: script lowered output feeds into markup pass", () => {
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

	assert_string_includes(result.code, `Code.Markup.Promise`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_string_includes(result.code, `renderDate`);
	assert_string_includes(result.code, `hasAccess`);
	assert_string_includes(result.code, `handleClick`);
	assert_string_includes(result.code, `{#if`);
	if (!result.has_yield) throw new Error("markup pass should detect yield*");
});

test("full pipeline: script and markup transforms agree on has_yield", () => {
	const script = `
    const x = $state(yield* compute());
  `.trim();

	const script_result = transform_script_effect(script, "Test.svelte");
	assert_string_includes(script_result.code, `__SER___`);

	const full = `<script>\n${script_result.code}\n</script>\n\n<p>{yield* getValue()}</p>`;

	const markup_result = transform_markup_effect(full, "Test.svelte");
	if (!markup_result.has_yield) throw new Error("markup pass failed");

	/** Second pass on markup output should be idempotent. */
	const second = transform_markup_effect(markup_result.code, "Test.svelte");
	if (second.code !== markup_result.code) {
		throw new Error("markup should be idempotent");
	}
});

test("full pipeline: script-only content passes through markup unchanged", () => {
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

test("full pipeline: markup-only passes through script unchanged", () => {
	const markup = `<p>{yield* getValue()}</p>`;

	const result = transform_script_effect(markup, "Test.svelte");
	if (result.code !== markup) throw new Error("expected identity output");
});

test("direct svelte transform lowers script effect and removes effect attribute", () => {
	const source = [
		`<script lang="ts" effect>`,
		`  let value = $state(yield* loadValue());`,
		`</script>`,
		`<p>{value}</p>`,
	].join("\n");

	const result = transform_svelte_effect(source, "Test.svelte");

	assert_string_includes(result.code, `<script lang="ts">`);
	assert_string_includes(result.code, `await get_dispatcher().promise({`);
	assert_string_includes(result.code, `$state(await`);
	assert_not_match(result.code, /\$effect\(\(\) =>/);
	if (result.code.includes(` effect>`)) {
		throw new Error("effect attribute should be removed before Svelte parses");
	}
});

test("direct svelte transform scans quoted script attributes", () => {
	const source = [
		`<script data-note="a > b" effect lang="ts">`,
		`  const marker = "</scripture>";`,
		`  let value = $state(yield* loadValue());`,
		`</script>`,
		`<p>{value}</p>`,
	].join("\n");
	const result = transform_svelte_effect(source, "QuotedScript.svelte");

	assert_string_includes(result.code, `<script data-note="a > b" lang="ts">`);
	assert_string_includes(result.code, `const marker = "</scripture>";`);
	assert_string_includes(result.code, `await get_dispatcher().promise({`);
	assert_not_match(result.code, /<script[^>]*\beffect\b/);
});

test("direct svelte transform emits async rune output Svelte can compile", () => {
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

test("direct svelte transform lowers snippet event attributes in full components", () => {
	const source = [
		`<script>`,
		`  import { Effect } from "effect";`,
		`</script>`,
		``,
		`{#snippet row()}`,
		`  <input onchange={yield* Effect.gen(function* () {})} />`,
		`{/snippet}`,
		``,
		`{@render row()}`,
	].join("\n");

	const result = transform_svelte_effect(source, "Creation.svelte");

	assert_string_includes(result.code, `onchange={(event) =>`);
	assert_string_includes(result.code, `Code.Markup.Run`);

	compile(result.code, {
		filename: "Creation.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("direct svelte transform lowers event-like attributes on component tags", () => {
	const source = [
		`<script>`,
		`  import { Effect } from "effect";`,
		`  import Child from "./Child.svelte";`,
		`</script>`,
		``,
		`<Child onChange={yield* Effect.succeed(event)} />`,
	].join("\n");

	const result = transform_svelte_effect(source, "Parent.svelte");

	assert_string_includes(result.code, `<Child onChange={(event) =>`);
	assert_string_includes(result.code, `Code.Markup.Run`);

	compile(result.code, {
		filename: "Parent.svelte",
		generate: "server",
		experimental: { async: true },
	});
});

test("direct svelte transform accepts optional filename", () => {
	const source = `<p>{yield* loadValue()}</p>`;

	const result = transform_svelte_effect(source);

	assert_string_includes(result.code, `Code.Markup.Promise`);
});

test("vite plugin keeps runtime package transformable in SSR builds", () => {
	const plugins = effect();
	const diagnostics_plugin = plugins.find(
		(plugin) => plugin.name === "svelte-effect-runtime:diagnostics",
	);
	const transform_plugin = plugins.find(
		(plugin) => plugin.name === "svelte-effect-runtime:svelte-transform",
	);
	const server_plugin = plugins.find(
		(plugin) => plugin.name === "svelte-effect-runtime:server-imports",
	);
	const client_plugin = plugins.find(
		(plugin) => plugin.name === "svelte-effect-runtime:remote-client",
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

	assert_equals(server_config, {
		optimizeDeps: { exclude: ["svelte-effect-runtime"] },
	});
	assert_equals(client_config, {
		ssr: { noExternal: ["svelte-effect-runtime"] },
	});

	const resolved_config = {
		ssr: {
			noExternal: ["svelte"],
		},
	};

	client_plugin.configResolved?.(resolved_config as never);

	assert_equals(resolved_config.ssr.noExternal, ["svelte", "svelte-effect-runtime"]);
});

test("vite server import rewrite handles query-suffixed server modules", async () => {
	const source = [
		`import { Redirect } from "svelte-effect-runtime";`,
		`import { get_dispatcher } from "svelte-effect-runtime/internal/generators";`,
		`export const Login = Redirect(303, "/oauth");`,
	].join("\n");
	const ids = [
		"C:/src/routes/auth.remote.ts?server",
		"C:/src/routes/auth.remote.m.ts?server",
		"C:/src/routes/auth.remote.c.ts?server",
		"C:/src/routes/auth.remote.js?server",
		"C:/src/routes/auth.remote.m.js?server",
		"C:/src/routes/auth.remote.c.js?server",
		"C:/src/routes/+page.server.ts?ts=123",
		"C:/src/hooks.server.ts?hmr=1",
		"C:/src/hooks.server.m.ts?hmr=1",
		"C:/src/hooks.server.c.ts?hmr=1",
		"C:/src/hooks.server.js?hmr=1",
		"C:/src/hooks.server.m.js?hmr=1",
		"C:/src/hooks.server.c.js?hmr=1",
	];

	for (const id of ids) {
		const result = await run_server_import_transform(source, id);

		assert_string_includes(result, `from "svelte-effect-runtime/server"`);
		assert_not_match(result, /from\s+["']svelte-effect-runtime["']/);
		assert_not_match(result, /from\s+["']svelte-effect-runtime\/internal\/generators["']/);
	}
});

test("vite server import rewrite parses imports instead of rewriting text", async () => {
	const source = [
		`import type { RequestEvent } from "svelte-effect-runtime";`,
		`export { Query } from "svelte-effect-runtime";`,
		`const generators = import("svelte-effect-runtime/internal/generators");`,
		`const example = 'from "svelte-effect-runtime"';`,
		`/** from "svelte-effect-runtime/internal/generators" */`,
	].join("\n");
	const result = await run_server_import_transform(source, "C:/src/routes/auth.remote.ts");

	assert_string_includes(
		result,
		`import type { RequestEvent } from "svelte-effect-runtime/server";`,
	);
	assert_string_includes(result, `export { Query } from "svelte-effect-runtime/server";`);
	assert_string_includes(result, `import("svelte-effect-runtime/server")`);
	assert_string_includes(result, `const example = 'from "svelte-effect-runtime"';`);
	assert_string_includes(result, `/** from "svelte-effect-runtime/internal/generators" */`);
});

test("vite server import rewrite retains SvelteKit's lowercase prerender binding", async () => {
	const source = [
		`import { Prerender as MakePrerender, Query } from "svelte-effect-runtime";`,
		`export const GetBuildInfo = MakePrerender(() => Effect.succeed("ready"));`,
		`export const GetPost = Query(() => Effect.succeed("post"));`,
	].join("\n");
	const result = await run_server_import_transform(source, "C:/src/lib/build.remote.ts");

	assert_string_includes(
		result,
		`import { Prerender as MakePrerender, Query } from "svelte-effect-runtime/server";`,
	);
	assert_string_includes(result, `import { prerender } from "$app/server";`);
	assert_string_includes(
		result,
		`export const GetBuildInfo = MakePrerender(() => Effect.succeed("ready"), undefined, undefined, prerender);`,
	);
	assert_string_includes(result, `export const GetPost = Query(() => Effect.succeed("post"));`);
});

test("vite server import rewrite retains prerender for namespace imports", async () => {
	const source = [
		`import * as SER from "svelte-effect-runtime";`,
		`export const GetBuildInfo = SER.Prerender(() => Effect.succeed("ready"));`,
	].join("\n");
	const result = await run_server_import_transform(source, "C:/src/lib/build.remote.ts");

	assert_string_includes(result, `import * as SER from "svelte-effect-runtime/server";`);
	assert_string_includes(result, `import { prerender } from "$app/server";`);
	assert_string_includes(
		result,
		`export const GetBuildInfo = SER.Prerender(() => Effect.succeed("ready"), undefined, undefined, prerender);`,
	);
});

test("vite server import rewrite ignores unused Prerender bindings", async () => {
	const source = [
		`import { Prerender } from "svelte-effect-runtime";`,
		`import * as SER from "svelte-effect-runtime";`,
		`const prerender = "local";`,
		`export const GetBuildInfo = SER.Query(() => Effect.succeed("ready"));`,
	].join("\n");
	const result = await run_server_import_transform(source, "C:/src/lib/build.remote.ts");

	assert_string_includes(result, `const prerender = "local";`);
	assert_string_includes(
		result,
		`export const GetBuildInfo = SER.Query(() => Effect.succeed("ready"));`,
	);
	assert_not_match(result, /from "\$app\/server"/);
});

test("vite server import rewrite handles wrapped Prerender initializers", async () => {
	const source = [
		`import { Prerender } from "svelte-effect-runtime";`,
		`type Remote = unknown;`,
		`export const Satisfied = Prerender(() => Effect.succeed("ready")) satisfies Remote;`,
		`export const Asserted = Prerender(() => Effect.succeed("ready")) as Remote;`,
		`export const Parenthesized = (Prerender(() => Effect.succeed("ready")));`,
	].join("\n");
	const result = await run_server_import_transform(source, "C:/src/lib/build.remote.ts");

	assert_string_includes(result, `import { prerender } from "$app/server";`);
	assert_string_includes(
		result,
		`Prerender(() => Effect.succeed("ready"), undefined, undefined, prerender) satisfies Remote`,
	);
	assert_string_includes(
		result,
		`Prerender(() => Effect.succeed("ready"), undefined, undefined, prerender) as Remote`,
	);
	assert_string_includes(
		result,
		`(Prerender(() => Effect.succeed("ready"), undefined, undefined, prerender))`,
	);
});

test("vite server import rewrite rejects conflicting prerender bindings", async () => {
	const source = [
		`import { Prerender } from "svelte-effect-runtime";`,
		`const prerender = () => undefined;`,
		`export const GetBuildInfo = Prerender(() => Effect.succeed("ready"));`,
	].join("\n");

	await assert_rejects(
		() => run_server_import_transform(source, "C:/src/lib/build.remote.ts"),
		Error,
		`Prerender remote modules reserve the top-level "prerender" binding for SvelteKit`,
	);
});

test("vite diagnostics plugin warns for bare Effect.gen event handlers", async () => {
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

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "onclick={Effect.gen}");
	assert_string_includes(warnings[0], "Effect.gen is a constructor");
	assert_string_includes(warnings[0], "onclick={yield* Effect.gen(function* () { ... })}");
});

test("vite diagnostics plugin recognizes mixed-case event attributes", async () => {
	const warnings: string[] = [];
	const diagnostics_plugin = get_diagnostics_plugin();
	const source = [
		`<script lang="ts">`,
		`  import { Effect } from "effect";`,
		`</script>`,
		``,
		`<button onChange={Effect.gen}>save</button>`,
	].join("\n");

	await diagnostics_plugin.transform.call(
		make_warning_context(warnings),
		source,
		"src/routes/+page.svelte",
	);

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "onChange={Effect.gen}");
	assert_string_includes(warnings[0], "onChange={yield* Effect.gen(function* () { ... })}");
});

test("vite diagnostics plugin follows Svelte's case-sensitive event classification", async () => {
	const warnings: string[] = [];
	const diagnostics_plugin = get_diagnostics_plugin();
	const source = [
		`<script lang="ts">`,
		`  import { Effect } from "effect";`,
		`</script>`,
		``,
		`<button ONCLICK={() => Effect.sync(() => save())}>save</button>`,
	].join("\n");

	await diagnostics_plugin.transform.call(
		make_warning_context(warnings),
		source,
		"src/routes/+page.svelte",
	);

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "Svelte attributes need the resolved Effect value");
});

test("vite diagnostics plugin does not treat mixed attribute values as events", async () => {
	const warnings: string[] = [];
	const diagnostics_plugin = get_diagnostics_plugin();
	const source = [
		`<script lang="ts">`,
		`  import { Effect } from "effect";`,
		`</script>`,
		``,
		`<button onclick="prefix-{Effect.sync(() => save())}">save</button>`,
	].join("\n");

	await diagnostics_plugin.transform.call(
		make_warning_context(warnings),
		source,
		"src/routes/+page.svelte",
	);

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "markup expression");

	if (warnings[0].includes("event attribute")) {
		throw new Error("mixed attribute values should not be diagnosed as event attributes");
	}
});

test("vite diagnostics plugin recognizes quoted single-expression event attributes", async () => {
	const warnings: string[] = [];
	const diagnostics_plugin = get_diagnostics_plugin();
	const source = [
		`<script lang="ts">`,
		`  import { Effect } from "effect";`,
		`</script>`,
		``,
		`<button onclick="{() => Effect.sync(() => save())}">save</button>`,
	].join("\n");

	await diagnostics_plugin.transform.call(
		make_warning_context(warnings),
		source,
		"src/routes/+page.svelte",
	);

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "event callback that returns an Effect");
});

test("vite diagnostics plugin ignores yielded Effect handlers", async () => {
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

	assert_equals(warnings, []);
});

test("vite diagnostics plugin warns for directive event Effect callbacks", async () => {
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

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "on:click");
	assert_string_includes(warnings[0], "Effect.sync");
	assert_string_includes(warnings[0], "returns an Effect but does not run it");
});

test("vite diagnostics plugin warns for hidden event callback yield", async () => {
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

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "yield* hidden inside an event callback");
	assert_string_includes(warnings[0], "event attribute boundary");
});

test("vite diagnostics plugin warns for explicit Effect runners", async () => {
	const warnings: string[] = [];
	const diagnostics_plugin = get_diagnostics_plugin();
	const runner_name = ["run", "Promise"].join("");
	const source = [
		`<script lang="ts">`,
		`  import { Effect } from "effect";`,
		`</script>`,
		``,
		`<button onclick={() => Effect.${runner_name}(Effect.gen(function* () {}))}>run</button>`,
	].join("\n");

	await diagnostics_plugin.transform.call(
		make_warning_context(warnings),
		source,
		"src/routes/+page.svelte",
	);

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "explicit Effect runner");
	assert_string_includes(warnings[0], "bypass SER cancellation");
});

test("vite diagnostics plugin warns for parenthesized Effect runners", async () => {
	const warnings: string[] = [];
	const diagnostics_plugin = get_diagnostics_plugin();
	const runner_name = ["run", "Promise"].join("");
	const source = [
		`<script lang="ts">`,
		`  import { Effect } from "effect";`,
		`</script>`,
		``,
		`<button onclick={() => (Effect).${runner_name}(Effect.succeed("ready"))}>run</button>`,
	].join("\n");

	await diagnostics_plugin.transform.call(
		make_warning_context(warnings),
		source,
		"src/routes/+page.svelte",
	);

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "explicit Effect runner");
	assert_string_includes(warnings[0], "bypass SER cancellation");
});

test("vite diagnostics plugin warns for non-event Effect attributes", async () => {
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

	assert_equals(warnings.length, 2);
	assert_string_includes(warnings[0], "attribute value");
	assert_string_includes(warnings[0], "disabled={yield* Effect.sync");
	assert_string_includes(warnings[1], "class:active={yield* Effect.succeed");
});

test("vite diagnostics plugin warns for sync markup Effect expressions", async () => {
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

	assert_equals(warnings.length, 3);
	assert_string_includes(warnings[0], "will produce an Effect value");
	assert_string_includes(warnings[0], "@const status = Effect.succeed");
	assert_string_includes(warnings[1], "#if Effect.succeed");
	assert_string_includes(warnings[2], "Effect.gen");
});

test("vite diagnostics plugin recognizes Effect import aliases", async () => {
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

	assert_equals(warnings.length, 1);
	assert_string_includes(warnings[0], "onclick={E.gen}");
	assert_string_includes(warnings[0], "E.gen is a constructor");
});

test("vite diagnostics plugin deduplicates repeated warnings", async () => {
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

	assert_equals(warnings.length, 1);
});

test("vite transform plugin logs possible pre transform plugin conflicts", () => {
	const plugins = effect();
	const infos: string[] = [];
	const transform_plugin = plugins.find(
		(plugin) => plugin.name === "svelte-effect-runtime:svelte-transform",
	);

	if (!transform_plugin || typeof transform_plugin.configResolved !== "function") {
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

	assert_equals(infos.length, 1);
	assert_string_includes(infos[0], "[svelte-effect-runtime]");
	assert_string_includes(
		infos[0],
		"Svelte Effect Runtime noticed possible Vite plugin ordering conflicts.",
	);
	assert_string_includes(infos[0], "  - pre-parser");
	assert_string_includes(infos[0], "  - wuchale");
	assert_string_includes(infos[0], "<script effect>");
	assert_string_includes(infos[0], "yield* in components");
	assert_not_match(infos[0], /remove/i);
});

test("vite plugins do not force pre transform ordering", () => {
	const plugins = effect();
	const pre_plugins = plugins.filter((plugin) => plugin.enforce === "pre");

	assert_equals(pre_plugins, []);
});

test("vite plugin does not reserve safely aliased markup helper names", async () => {
	const plugins = effect();
	const guard_plugin = plugins.find(
		(candidate) => candidate.name === "svelte-effect-runtime:reserved-helper-guard",
	);
	const transform_plugin = plugins.find(
		(candidate) => candidate.name === "svelte-effect-runtime:svelte-transform",
	);
	const source = [
		`<script>`,
		`  const Dispatcher = "local dispatcher";`,
		`  function loadValue() {}`,
		`</script>`,
		`<Component let:Dispatcher>`,
		`  {#each [1] as Code}`,
		`    <p>{Code}: {yield* loadValue()}</p>`,
		`  {/each}`,
		`</Component>`,
	].join("\n");

	if (!transform_plugin) {
		throw new Error("svelte transform plugin should exist");
	}

	const result = await run_svelte_transform(
		transform_plugin,
		source,
		"C:/src/routes/Test.svelte",
	);

	assert_equals(guard_plugin, undefined);
	assert_string_includes(result.code, "Code as Code_1");
	assert_string_includes(result.code, "Dispatcher as Dispatcher_1");
});

test("vite plugin lowers svelte yield through its transform hook", async () => {
	const plugins = effect();
	const plugin = plugins.find(
		(candidate) => candidate.name === "svelte-effect-runtime:svelte-transform",
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

	const result = await run_svelte_transform(plugin, source, "C:/src/routes/Test.svelte");

	assert_string_includes(result.code, `<script lang="ts">`);
	assert_string_includes(result.code, `await get_dispatcher().promise({`);
	assert_string_includes(result.code, `$state(await`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_not_match(result.code, /\$effect\(\(\) =>/);

	parse(result.code, { filename: "Test.svelte" });

	if (/script[^>]*\beffect\b/.test(result.code)) {
		throw new Error("effect attribute should be removed");
	}

	if (result.code.includes(`onclick={yield*`)) {
		throw new Error("markup yield should be lowered");
	}
});

test("vite plugin lowers svelte yield in configured extension modules", async () => {
	const plugins = effect();
	const plugin = plugins.find(
		(candidate) => candidate.name === "svelte-effect-runtime:svelte-transform",
	);

	if (!plugin) {
		throw new Error("svelte transform plugin should exist");
	}

	plugin.configResolved?.({
		plugins: [
			{
				name: "vite-plugin-svelte:config",
				api: {
					options: {
						extensions: [".svelte", ".sv"],
					},
				},
			},
		],
		logger: {
			info() {},
		},
	} as never);

	const source = [
		`<script effect lang="ts">`,
		`  let value = $state(yield* loadValue());`,
		`</script>`,
		``,
		`<button onclick={yield* save(value)}>Save</button>`,
	].join("\n");

	const result = await run_svelte_transform(plugin, source, "C:/src/routes/Test.sv");

	assert_string_includes(result.code, `<script lang="ts">`);
	assert_string_includes(result.code, `await get_dispatcher().promise({`);
	assert_string_includes(result.code, `$state(await`);
	assert_string_includes(result.code, `Code.Markup.Run`);
	assert_not_match(result.code, /\$effect\(\(\) =>/);

	parse(result.code, { filename: "Test.sv" });

	if (/script[^>]*\beffect\b/.test(result.code)) {
		throw new Error("effect attribute should be removed");
	}

	if (result.code.includes(`onclick={yield*`)) {
		throw new Error("markup yield should be lowered");
	}
});

test("vite plugin emits client and server promises", async () => {
	const plugins = effect();
	const plugin = plugins.find(
		(candidate) => candidate.name === "svelte-effect-runtime:svelte-transform",
	);

	if (!plugin) {
		throw new Error("svelte transform plugin should exist");
	}

	const source = `<p>{yield* loadValue()}</p>`;

	const client = await run_svelte_transform(plugin, source, "C:/src/routes/Test.svelte", {
		ssr: false,
	});
	const server = await run_svelte_transform(plugin, source, "C:/src/routes/Test.svelte", {
		ssr: true,
	});

	assert_string_includes(client.code, `await Dispatcher.emit({ type: Code.Markup.Promise`);
	assert_string_includes(server.code, `await Dispatcher.emit({ type: Code.Markup.Promise`);
	assert_string_includes(server.code, `ssr_fallback: undefined`);

	if (client.code.includes(`Code.Markup.Value`)) {
		throw new Error("client transform should not emit value reads");
	}

	if (client.code.includes(`ssr_fallback`)) {
		throw new Error("client transform should not emit SSR fallbacks");
	}
});

test("generated promise helpers use ServerRuntime services during SSR", async () => {
	reset_server_runtime();

	const ReproService = Context.Service<{ readonly value: string }>("ReproService");

	try {
		ServerRuntime.make(Layer.succeed(ReproService, { value: "server-service" }));

		const result = await promise("server-service", [], function* () {
			return yield* ReproService;
		});

		assert_equals(result.value, "server-service");
	} finally {
		reset_server_runtime();
	}
});

test("ServerRuntime.make survives Vite dev SSR hook reloads", async () => {
	const temp_dir = await mkdtemp(join(tmpdir(), "ser-hmr-repro-"));
	const source_root = normalizePath(
		fileURLToPath(new URL("../../../modules/svelte-effect-runtime/src", import.meta.url)),
	);
	const hook_path = join(temp_dir, "src", "hooks.server.ts");

	await mkdir(join(temp_dir, "src"), { recursive: true });
	await writeFile(
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
			alias: [{ find: /^\$\/(.*)$/, replacement: `${source_root}/$1` }],
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
		await rm(temp_dir, { recursive: true, force: true });
	}
});

test("ServerRuntime.make throws when the server runtime already exists", () => {
	reset_server_runtime();

	try {
		ServerRuntime.make();

		const error = assert_throws(
			() => ServerRuntime.make(),
			RuntimeAlreadyInitializedError,
			"ServerRuntime.make(...) cannot be called",
		);

		assert_equals(error.name, "RuntimeAlreadyInitializedError");
	} finally {
		reset_server_runtime();
	}
});

test("ServerRuntime.make throws after lazy server runtime creation", () => {
	reset_server_runtime();

	try {
		get_server_runtime_or_throw();

		const error = assert_throws(
			() => ServerRuntime.make(),
			RuntimeAlreadyInitializedError,
			"runtime has already been initialized",
		);

		assert_equals(error.name, "RuntimeAlreadyInitializedError");
	} finally {
		reset_server_runtime();
	}
});

function make_warning_context(warnings: string[]): {
	warn(warning: string | { message?: string }): void;
} {
	return {
		warn(warning: string | { message?: string }) {
			warnings.push(typeof warning === "string" ? warning : (warning.message ?? ""));
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
	const diagnostics_plugin = plugins.find(
		(plugin) => plugin.name === "svelte-effect-runtime:diagnostics",
	);

	if (!diagnostics_plugin || typeof diagnostics_plugin.transform !== "function") {
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

test("root entry exposes server helpers for rewritten server imports", async () => {
	const root = await import("../../../modules/svelte-effect-runtime/src/mod.ts");

	assert_equals(typeof root.ServerRuntime.make, "function");
	assert_equals(typeof root.Query, "function");
	assert_equals(typeof root.Query.batch, "function");
	assert_equals(typeof root.Query.live, "function");
	assert_equals(typeof root.Command, "function");
	assert_equals(typeof root.Form, "function");
	assert_equals(typeof root.Prerender, "function");
	assert_equals(typeof root.get_server_runtime_or_throw, "function");
	assert_equals(typeof root.RequestEvent, "function");
});

test("root server-only exports throw before Vite rewrites imports", async () => {
	const root = await import("../../../modules/svelte-effect-runtime/src/mod.ts");
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
		const error = assert_throws(call, Error);

		assert_string_includes(error.message, name);
		assert_string_includes(error.message, "Vite plugin");
	}
});

test("package manifests expose compiler and transform entrypoints", async () => {
	const package_manifest = JSON.parse(
		await readFile(
			new URL("../../../modules/svelte-effect-runtime/package.json", import.meta.url),
			"utf8",
		),
	);

	assert_equals(package_manifest.exports["./compiler"], {
		types: "./.dist/compiler.d.ts",
		default: "./.dist/compiler.js",
	});
	assert_equals(package_manifest.exports["./runtime/transform"], {
		types: "./.dist/runtime/transform.d.ts",
		default: "./.dist/runtime/transform.js",
	});
	assert_equals(package_manifest.exports["./grammars"], undefined);
	assert_equals(package_manifest.dependencies["svelte-effect-runtime-grammars"], undefined);
	assert_equals(package_manifest.exports["./vite"], undefined);
	assert_equals(package_manifest.exports["./runtime/preprocess"], undefined);
});

test("compiler entrypoint defers compiler-only imports until transform hooks", async () => {
	const source = await readFile(
		new URL("../../../modules/svelte-effect-runtime/src/compiler.ts", import.meta.url),
		"utf8",
	);
	const static_import_pattern = /^import\s+.*["']\.\/runtime\/transform\.ts["'];/m;
	const static_typescript_import_pattern = /^import\s+.*["']typescript["'];/m;
	const static_magic_string_import_pattern = /^import\s+.*["']magic-string["'];/m;

	if (static_import_pattern.test(source)) {
		throw new Error("vite entrypoint should not statically import transformer");
	}

	if (static_typescript_import_pattern.test(source)) {
		throw new Error("vite entrypoint should not statically import TypeScript");
	}

	if (static_magic_string_import_pattern.test(source)) {
		throw new Error("vite entrypoint should not statically import MagicString");
	}

	assert_string_includes(source, `await import(`);
	assert_string_includes(source, `"./runtime/transform.ts"`);
	assert_string_includes(source, `"./compiler/remote-client.ts"`);
});

test("vite remote client wrapper preserves native SvelteKit remote module", async () => {
	const source = [
		`import * as __remote from '__sveltekit/remote';`,
		``,
		`export const get_post = __remote.query('abc/get_post');`,
		`export const get_post_batch = __remote.query_batch('abc/get_post_batch');`,
		`export const get_clock = __remote.query_live('abc/get_clock');`,
		`export const save_post = __remote.command('abc/save_post');`,
		`export const create_post = __remote.form('abc/create_post');`,
		`export const get_build_info = __remote.prerender('abc/get_build_info');`,
	].join("\n");

	const result = await rewrite_remote_client_exports(source);

	assert_string_includes(result, `from '__sveltekit/remote';`);
	assert_string_includes(result, `create_remote_query_adapter`);
	assert_string_includes(result, `create_remote_live_query_adapter`);
	assert_string_includes(result, `create_remote_command_adapter`);
	assert_string_includes(result, `create_remote_form_adapter`);
	assert_string_includes(result, `from "$app/navigation";`);
	assert_string_includes(result, `globalThis.location.assign(target.href);`);
	assert_string_includes(result, `__SER___goto(target, { invalidateAll: invalidate_all })`);
	assert_string_includes(
		result,
		`binary_form_content_type: __remote.__SER___binary_form_content_type`,
	);
	assert_string_includes(result, `remote_request: __remote.__SER___remote_request`);
	assert_string_includes(result, `serialize_binary_form: __remote.__SER___serialize_binary_form`);
	assert_not_match(result, /from "__sveltekit\/manifest";/);
	assert_string_includes(
		result,
		`export const get_post = create_remote_query_adapter(__remote.query('abc/get_post'), __SER___decode_payload);`,
	);
	assert_string_includes(
		result,
		`export const get_post_batch = create_remote_query_adapter(__remote.query_batch('abc/get_post_batch'), __SER___decode_payload, "", "batch");`,
	);
	assert_string_includes(
		result,
		`export const get_clock = create_remote_live_query_adapter(__remote.query_live('abc/get_clock'), __SER___decode_payload);`,
	);
	assert_string_includes(
		result,
		`export const save_post = create_remote_command_adapter(__remote.command('abc/save_post'), __SER___decode_payload);`,
	);
	assert_string_includes(
		result,
		`export const create_post = create_remote_form_adapter(__remote.form('abc/create_post'), __SER___decode_payload, __SER___remote_base, __SER___remote_form_transport);`,
	);
	assert_string_includes(
		result,
		`export const get_build_info = create_remote_prerender_adapter(__remote.prerender('abc/get_build_info'), __SER___decode_payload);`,
	);

	if (result.indexOf(`const __SER___remote_base`) > result.indexOf(`export const create_post`)) {
		throw new Error("remote helpers must be declared before wrapped exports");
	}
});
