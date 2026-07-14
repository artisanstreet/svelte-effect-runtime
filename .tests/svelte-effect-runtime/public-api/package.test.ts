import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	assert_command_succeeded,
	ensure_packed_artifact,
	prepare_workspace,
	read_primary_dependency_versions,
	resolve_installed_package_root,
	run_command,
} from "./packed-artifact.ts";

type ExportCondition = {
	readonly default: string;
	readonly types: string;
};

type PackedManifest = {
	readonly exports: Readonly<Record<string, ExportCondition>>;
	readonly files: readonly string[];
	readonly name: string;
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
	"ClientRuntime",
	"Command",
	"Error",
	"Form",
	"Live",
	"Prerender",
	"Query",
	"Redirect",
	"RequestEvent",
	"ServerOnlyImportError",
	"ServerRuntime",
	"effect",
	"get_server_runtime_or_throw",
	"is_form_error",
	"is_remote_http_error",
	"is_remote_transport_error",
	"is_remote_validation_error",
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

	for (const entrypoint of required_entrypoints) {
		const conditions = manifest.exports[entrypoint];

		expect(conditions, `missing export map entry ${entrypoint}`).toBeDefined();
		expect(conditions.types).toMatch(/^\.\/\.dist\/.*\.d\.ts$/);
		expect(conditions.default).toMatch(/^\.\/\.dist\/.*\.js$/);

		await expect(stat(join(package_root, conditions.types.slice(2)))).resolves.toBeDefined();
		await expect(stat(join(package_root, conditions.default.slice(2)))).resolves.toBeDefined();
	}

	await expect(stat(join(package_root, "LICENSE"))).resolves.toBeDefined();
	await expect(stat(join(package_root, "README.md"))).resolves.toBeDefined();
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

	expect(observed.root).toEqual(expect.arrayContaining([...required_root_exports]));
	expect(observed.compiler).toEqual(
		expect.arrayContaining(["effect", "rewrite_remote_client_exports"]),
	);
}, 180_000);
