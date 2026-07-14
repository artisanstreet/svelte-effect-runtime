import { Buffer } from "node:buffer";
import { readFile, realpath } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { compile } from "svelte/compiler";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const signals_root = dirname(fileURLToPath(import.meta.url));
const workspace_root = resolve(signals_root, "../../..");
const runtime_source_root = resolve(workspace_root, "modules/svelte-effect-runtime/src");
const svelte_source_root = resolve(workspace_root, "node_modules/svelte/src").replaceAll("\\", "/");
const server_component_suffix = "?signals-ssr";
const server_component_prefix = "\0signals-ssr:";
const server_renderer_id = "virtual:signals-ssr-renderer";
const resolved_server_renderer_id = "\0signals-ssr-renderer";

function make_file_import(filename: string): string {
	return `/@fs/${filename}`;
}

type TransformSvelteEffect = (
	content: string,
	filename: string,
	options: { target: "server" },
) => { code: string };

function server_component_plugin(transform_svelte_effect: TransformSvelteEffect): Plugin {
	return {
		name: "signals:ssr-components",
		enforce: "pre",

		resolveId(source, importer) {
			if (source === server_renderer_id) {
				return resolved_server_renderer_id;
			}

			if (!source.endsWith(server_component_suffix) || !importer) {
				return undefined;
			}

			const source_path = source.slice(0, -server_component_suffix.length);
			const importer_path = importer.split("?", 1)[0] ?? importer;
			const filename = resolve(dirname(importer_path), source_path);

			return `${server_component_prefix}${Buffer.from(filename).toString("base64url")}`;
		},

		async load(id) {
			if (id === resolved_server_renderer_id) {
				const renderer = make_file_import(`${svelte_source_root}/server/index.js`);

				return `export { render } from ${JSON.stringify(renderer)};`;
			}

			if (!id.startsWith(server_component_prefix)) {
				return undefined;
			}

			const encoded_filename = id.slice(server_component_prefix.length);
			const filename = Buffer.from(encoded_filename, "base64url").toString("utf8");
			const source = await readFile(filename, "utf8");
			const transformed = transform_svelte_effect(source, filename, {
				target: "server",
			});
			const compiled = compile(transformed.code, {
				filename,
				generate: "server",
				experimental: { async: true },
			});
			const async_flag = make_file_import(`${svelte_source_root}/internal/flags/async.js`);
			const server_runtime = make_file_import(
				`${svelte_source_root}/internal/server/index.js`,
			);
			const code = compiled.js.code
				.replaceAll("'svelte/internal/flags/async'", JSON.stringify(async_flag))
				.replaceAll("'svelte/internal/server'", JSON.stringify(server_runtime));

			return { ...compiled.js, code };
		},
	};
}

const svelte_package_root = await realpath(resolve(workspace_root, "node_modules/svelte"));
const esm_env_root = resolve(svelte_package_root, "../esm-env").replaceAll("\\", "/");

registerHooks({
	resolve(specifier, context, next_resolve) {
		if (specifier.startsWith("$/")) {
			const filename = resolve(runtime_source_root, specifier.slice(2));

			return { url: pathToFileURL(filename).href, shortCircuit: true };
		}

		return next_resolve(specifier, context);
	},
});

const compiler_url = pathToFileURL(resolve(runtime_source_root, "compiler.ts")).href;
const transform_url = pathToFileURL(resolve(runtime_source_root, "runtime/transform.ts")).href;
const [{ effect }, { transform_svelte_effect }] = await Promise.all([
	import(compiler_url),
	import(transform_url),
]);

export default defineConfig({
	plugins: [
		server_component_plugin(transform_svelte_effect),
		...effect(),
		svelte({
			compilerOptions: {
				experimental: { async: true },
			},
		}),
	],
	resolve: {
		alias: [
			{
				find: /^esm-env\/browser$/,
				replacement: `${esm_env_root}/true.js`,
			},
			{
				find: /^esm-env\/development$/,
				replacement: `${esm_env_root}/true.js`,
			},
			{
				find: /^esm-env\/node$/,
				replacement: `${esm_env_root}/false.js`,
			},
			{
				find: /^esm-env$/,
				replacement: `${esm_env_root}/index.js`,
			},
			{
				find: /^\$\//,
				replacement: `${runtime_source_root.replaceAll("\\", "/")}/`,
			},
			{
				find: /^svelte-effect-runtime\/internal\//,
				replacement: `${resolve(runtime_source_root, "internal").replaceAll("\\", "/")}/`,
			},
			{
				find: /^svelte-effect-runtime\//,
				replacement: `${runtime_source_root.replaceAll("\\", "/")}/`,
			},
			{
				find: "svelte-effect-runtime",
				replacement: resolve(runtime_source_root, "mod.ts").replaceAll("\\", "/"),
			},
		],
	},
	optimizeDeps: {
		noDiscovery: true,
	},
	test: {
		include: [".tests/svelte-effect-runtime/signals/**/*.browser.test.ts"],
		testTimeout: 30_000,
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: "chromium" }],
		},
	},
});
