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

type ExportCondition = {
	readonly default: string;
	readonly types: string;
};

type PackedManifest = {
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly exports: Readonly<Record<string, ExportCondition>>;
	readonly files: readonly string[];
	readonly name: string;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly type: string;
	readonly version: string;
};

const required_entrypoints = [
	".",
	"./server",
	"./compiler",
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
	const manifest = JSON.parse(
		await readFile(join(package_root, "package.json"), "utf8"),
	) as PackedManifest;

	expect(manifest.name).toBe("svelte-effect-runtime");
	expect(manifest.type).toBe("module");
	expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
	expect(manifest.files).toContain(".dist");
	expect(Object.keys(manifest.exports).sort()).toEqual([...required_entrypoints].sort());
	expect(JSON.stringify([manifest.dependencies, manifest.peerDependencies])).not.toContain(
		"workspace:",
	);

	for (const entrypoint of required_entrypoints) {
		const conditions = manifest.exports[entrypoint];

		expect(conditions, `missing export map entry ${entrypoint}`).toBeDefined();
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

test("packed root and compiler entrypoints expose the runtime API through Node resolution", async () => {
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
		"console.log(JSON.stringify({ root: Object.keys(root), compiler: Object.keys(compiler) }));",
	].join("\n");
	const result = run_command(
		process.execPath,
		["--input-type=module", "--eval", probe],
		workspace,
	);

	assert_command_succeeded("import packed public entrypoints", result);

	const observed = JSON.parse(result.stdout) as {
		readonly compiler: readonly string[];
		readonly root: readonly string[];
	};

	expect(observed.root.sort()).toEqual([...required_root_exports].sort());
	expect(observed.compiler.sort()).toEqual(["effect", "rewrite_remote_client_exports"]);
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

	const browser = JSON.parse(browser_result.stdout) as {
		readonly failures: readonly string[];
		readonly resolved: string;
	};

	expect(browser.failures).toEqual(["ServerOnlyImportError", "ServerOnlyImportError"]);
	expect(browser.resolved.replaceAll("\\", "/")).toMatch(/\/\.dist\/mod\.js$/);

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

	const server = JSON.parse(server_result.stdout) as {
		readonly exports: readonly string[];
		readonly resolved: string;
	};

	expect(server.exports.sort()).toEqual([...required_server_exports].sort());
	expect(server.resolved.replaceAll("\\", "/")).toMatch(/\/\.dist\/server\.js$/);
}, 180_000);
