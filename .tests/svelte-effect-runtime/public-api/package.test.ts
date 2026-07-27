import {
	assert_command_succeeded,
	ensure_packed_artifact,
	prepare_workspace,
	read_primary_dependency_versions,
	resolve_installed_package_root,
	run_command,
} from "./packed-artifact.ts";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { join } from "node:path";
import { Schema } from "effect";

const StringRecord = Schema.Record(Schema.String, Schema.String);
const ExportConditionSchema = Schema.Struct({
	default: Schema.String,
	types: Schema.String,
});
const PackedManifestSchema = Schema.Struct({
	dependencies: Schema.optional(StringRecord),
	exports: Schema.Record(Schema.String, ExportConditionSchema),
	files: Schema.Array(Schema.String),
	name: Schema.String,
	peerDependencies: Schema.optional(StringRecord),
	type: Schema.String,
	version: Schema.String,
});
const ModuleExportsSchema = Schema.Struct({
	compiler: Schema.Array(Schema.String),
	environment: Schema.Array(Schema.String),
	root: Schema.Array(Schema.String),
});
const BrowserProbeSchema = Schema.Struct({
	failures: Schema.Array(Schema.String),
	resolved: Schema.String,
});
const ServerProbeSchema = Schema.Struct({
	exports: Schema.Array(Schema.String),
	resolved: Schema.String,
});
const MinimumPeerProbeSchema = Schema.Struct({
	bridge_loaded: Schema.Literal(true),
	kit_version: Schema.Literal("2.69.0"),
	server_loaded: Schema.Literal(true),
});

const required_entrypoints = [
	".",
	"./server",
	"./compiler",
	"./environment",
	"./runtime/transform",
	"./internal/generators",
	"./internal/remote-client",
	"./internal/remote-server",
] as const;

const required_root_exports = [
	"AsyncEffectInEventCallbackError",
	"AsyncEffectInSyncRuneError",
	"AwaitInEffectWorkError",
	"BatchQueryHandlerMissingError",
	"ClientRuntime",
	"Command",
	"DefineEnvVars",
	"DispatcherDisposedError",
	"EmptyStreamYieldError",
	"Error",
	"Form",
	"InvalidCommandFactoryError",
	"InvalidLiveQueryFactoryError",
	"InvalidLiveQueryReturnError",
	"InvalidPrerenderFactoryError",
	"InvalidQueryFactoryError",
	"InvalidRemoteFormResponseError",
	"InvalidYieldableError",
	"Live",
	"PreprocessError",
	"Prerender",
	"Query",
	"Redirect",
	"RemoteErrorDecodeError",
	"RemoteFormEndpointMissingError",
	"RemoteHelperContextError",
	"RemoteHelperError",
	"RequestEvent",
	"RequestEventUnavailableError",
	"RuntimeAlreadyInitializedError",
	"RuntimeError",
	"ServerOnlyImportError",
	"ServerRuntime",
	"ScopeDisposedError",
	"SvelteKitServerExportUnavailableError",
	"UncheckedCommandHandlerMissingError",
	"UncheckedFormHandlerMissingError",
	"UncheckedLiveQueryHandlerMissingError",
	"UncheckedPrerenderHandlerMissingError",
	"UncheckedQueryHandlerMissingError",
	"UnsupportedMarkupEffectPositionError",
	"UnsupportedRemoteFormResponseError",
	"YieldStarInEventCallbackError",
	"effect",
	"get_server_runtime_or_throw",
	"is_form_error",
	"is_remote_http_error",
	"is_remote_transport_error",
	"is_remote_validation_error",
] as const;

const required_server_exports = [
	"Command",
	"Error",
	"Form",
	"Handler",
	"Live",
	"Prerender",
	"Query",
	"Redirect",
	"RequestEvent",
	"ServerRuntime",
	"get_server_runtime_or_throw",
] as const;

test("packed package resolves every supported public and generated entrypoint", async () => {
	const artifact = await ensure_packed_artifact();
	const versions = await read_primary_dependency_versions();
	const workspace = await prepare_workspace("public-api", artifact, {
		name: "ser-packed-public-api-contract",
		private: true,
		type: "module",
		dependencies: versions,
	});
	const package_root = await resolve_installed_package_root(workspace);
	const manifest = Schema.decodeUnknownSync(PackedManifestSchema)(
		JSON.parse(await readFile(join(package_root, "package.json"), "utf8")),
	);

	expect(manifest.name).toBe("svelte-effect-runtime");
	expect(manifest.type).toBe("module");
	expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
	expect(manifest.files).toContain(".dist");
	expect(Object.keys(manifest.exports).sort()).toEqual([...required_entrypoints].sort());
	expect(manifest.peerDependencies?.["@sveltejs/kit"]).toBe("^2.69.0 || ^3.0.0-next.0");
	expect(JSON.stringify([manifest.dependencies, manifest.peerDependencies])).not.toContain(
		"workspace:",
	);

	for (const entrypoint of required_entrypoints) {
		const conditions = manifest.exports[entrypoint];

		expect(conditions, `missing export map entry ${entrypoint}`).toBeDefined();

		if (!conditions) {
			throw new Error(`Missing export map entry ${entrypoint}.`);
		}

		expect(Object.keys(conditions).sort()).toEqual(["default", "types"]);
		expect(conditions.types).toMatch(/^\.\/\.dist\/.*\.d\.ts$/);
		expect(conditions.default).toMatch(/^\.\/\.dist\/.*\.js$/);

		const declaration = await stat(join(package_root, conditions.types.slice(2)));
		const implementation = await stat(join(package_root, conditions.default.slice(2)));

		expect(declaration.isFile(), `${entrypoint} declaration is not a file`).toBe(true);
		expect(implementation.isFile(), `${entrypoint} implementation is not a file`).toBe(true);
	}

	await expect(stat(join(package_root, "LICENSE"))).resolves.toBeDefined();
	await expect(stat(join(package_root, "README.md"))).resolves.toBeDefined();

	const package_entries = await readdir(package_root);
	const artifact_entries = package_entries.filter((entry) => entry !== "node_modules");

	expect(artifact_entries.sort()).toEqual(
		[".dist", "LICENSE", "README.md", "package.json"].sort(),
	);
}, 180_000);

test("packed compiler bridge loads at the minimum supported SvelteKit peer", async () => {
	const artifact = await ensure_packed_artifact();
	const primary_versions = await read_primary_dependency_versions();
	const workspace = await prepare_workspace("minimum-sveltekit-peer", artifact, {
		name: "ser-packed-minimum-sveltekit-peer",
		private: true,
		type: "module",
		dependencies: {
			...primary_versions,
			"@sveltejs/kit": "2.69.0",
		},
	});

	await write_app_server_stub(workspace);

	const probe = [
		"import { readFile } from 'node:fs/promises';",
		"import { createRequire } from 'node:module';",
		"import { dirname, join } from 'node:path';",
		"import { effect } from 'svelte-effect-runtime/compiler';",
		"const require = createRequire(import.meta.url);",
		"const kit = require('@sveltejs/kit/package.json');",
		"const kit_root = dirname(require.resolve('@sveltejs/kit/package.json'));",
		"const index_path = join(kit_root, 'src', 'runtime', 'client', 'remote-functions', 'index.js');",
		"const index_source = await readFile(index_path, 'utf8');",
		"const plugin = effect().find((candidate) => candidate.name === 'svelte-effect-runtime:remote-client');",
		"if (!plugin || typeof plugin.transform !== 'function') throw new Error('Missing remote client transform');",
		"const transformed = await plugin.transform.call({}, index_source, index_path);",
		"const code = typeof transformed === 'string' ? transformed : transformed?.code;",
		"const bridge_loaded = ['__SER___remote_request', '__SER___serialize_binary_form', '__SER___binary_form_content_type'].every((name) => code?.includes(name));",
		"await import('svelte-effect-runtime/server');",
		"console.log(JSON.stringify({ bridge_loaded, kit_version: kit.version, server_loaded: true }));",
	].join("\n");
	const result = run_command(
		process.execPath,
		["--conditions=node", "--input-type=module", "--eval", probe],
		workspace,
	);

	assert_command_succeeded("load packed compiler bridge at minimum SvelteKit peer", result);

	const observed = Schema.decodeUnknownSync(MinimumPeerProbeSchema)(JSON.parse(result.stdout));

	expect(observed).toEqual({
		bridge_loaded: true,
		kit_version: "2.69.0",
		server_loaded: true,
	});
}, 180_000);

test("packed public entrypoints expose the runtime API through Node resolution", async () => {
	const artifact = await ensure_packed_artifact();
	const versions = await read_primary_dependency_versions();
	const workspace = await prepare_workspace("public-imports", artifact, {
		name: "ser-packed-import-contract",
		private: true,
		type: "module",
		dependencies: versions,
	});
	const probe = [
		"const root = await import('svelte-effect-runtime');",
		"const compiler = await import('svelte-effect-runtime/compiler');",
		"const environment = await import('svelte-effect-runtime/environment');",
		"console.log(JSON.stringify({ root: Object.keys(root), compiler: Object.keys(compiler), environment: Object.keys(environment) }));",
	].join("\n");
	const result = run_command(
		process.execPath,
		["--input-type=module", "--eval", probe],
		workspace,
	);

	assert_command_succeeded("import packed public entrypoints", result);

	const observed = Schema.decodeUnknownSync(ModuleExportsSchema)(JSON.parse(result.stdout));

	expect([...observed.root].sort()).toEqual([...required_root_exports].sort());
	expect([...observed.compiler].sort()).toEqual(["effect", "rewrite_remote_client_exports"]);
	expect([...observed.environment].sort()).toEqual(["DefineEnvVars"]);
}, 180_000);

test("packed browser and server entrypoints preserve their runtime boundaries", async () => {
	const artifact = await ensure_packed_artifact();
	const versions = await read_primary_dependency_versions();
	const workspace = await prepare_workspace("public-conditions", artifact, {
		name: "ser-packed-condition-contract",
		private: true,
		type: "module",
		dependencies: versions,
	});
	const browser_probe = [
		"const root = await import('svelte-effect-runtime');",
		"const failures = [];",
		"for (const invoke of [() => root.Query(), () => root.ServerRuntime.make()]) {",
		"  try { invoke(); } catch (error) { failures.push(error.constructor.name); }",
		"}",
		"console.log(JSON.stringify({ failures, resolved: import.meta.resolve('svelte-effect-runtime') }));",
	].join("\n");
	const browser_result = run_command(
		process.execPath,
		["--conditions=browser", "--input-type=module", "--eval", browser_probe],
		workspace,
	);

	assert_command_succeeded("probe packed browser entrypoint", browser_result);

	const browser = Schema.decodeUnknownSync(BrowserProbeSchema)(JSON.parse(browser_result.stdout));

	expect(browser.failures).toEqual(["ServerOnlyImportError", "ServerOnlyImportError"]);
	expect(browser.resolved.replaceAll("\\", "/")).toMatch(/\/\.dist\/mod\.js$/);

	await write_app_server_stub(workspace);

	const server_probe = [
		"const server = await import('svelte-effect-runtime/server');",
		"const runtime = server.ServerRuntime.make();",
		"console.log(JSON.stringify({ exports: Object.keys(server), resolved: import.meta.resolve('svelte-effect-runtime/server') }));",
		"await runtime.dispose();",
	].join("\n");
	const server_result = run_command(
		process.execPath,
		["--conditions=node", "--input-type=module", "--eval", server_probe],
		workspace,
	);

	assert_command_succeeded("probe packed server entrypoint", server_result);

	const server = Schema.decodeUnknownSync(ServerProbeSchema)(JSON.parse(server_result.stdout));

	expect([...server.exports].sort()).toEqual([...required_server_exports].sort());
	expect(server.resolved.replaceAll("\\", "/")).toMatch(/\/\.dist\/server\.js$/);
}, 180_000);

async function write_app_server_stub(workspace: string): Promise<void> {
	const app_virtual_module = join(workspace, "node_modules", "$app");

	await mkdir(app_virtual_module, { recursive: true });
	await writeFile(
		join(app_virtual_module, "package.json"),
		JSON.stringify({
			name: "$app",
			type: "module",
			exports: { "./server": "./server.js" },
		}),
	);
	await writeFile(
		join(app_virtual_module, "server.js"),
		[
			"export const command = () => undefined;",
			"export const form = () => undefined;",
			"export const getRequestEvent = () => ({});",
			"export const prerender = () => undefined;",
			"export const query = Object.assign(() => undefined, {",
			"  batch: () => undefined,",
			"  live: () => undefined,",
			"});",
			"",
		].join("\n"),
	);
}
