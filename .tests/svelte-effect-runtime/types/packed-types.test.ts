import { cp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	assert_command_succeeded,
	ensure_packed_artifact,
	prepare_workspace,
	read_primary_dependency_versions,
	run_command,
} from "../public-api/packed-artifact.ts";

const fixture_root = fileURLToPath(new URL("./fixtures", import.meta.url));
const negative_fixtures = [
	"query-handler-negative.ts",
	"query-input-negative.ts",
	"runtime-layer-negative.ts",
] as const;

let workspace_promise: Promise<string> | undefined;

test("packed declarations preserve positive public inference contracts", async () => {
	const workspace = await prepare_types_workspace();
	const tsconfig_path = await write_tsconfig(workspace, ["public-api-positive.ts"]);
	const result = run_command("corepack", ["pnpm", "exec", "tsc", "-p", tsconfig_path], workspace);

	assert_command_succeeded("compile positive packed type contracts", result);
}, 180_000);

test("packed declarations reject invalid handlers, missing inputs, and non-Layer runtimes", async () => {
	const workspace = await prepare_types_workspace();
	const tsconfig_path = await write_tsconfig(workspace, negative_fixtures);
	const result = run_command("corepack", ["pnpm", "exec", "tsc", "-p", tsconfig_path], workspace);
	const diagnostics = `${result.stdout}${result.stderr}`;

	expect(result.status).not.toBe(0);

	for (const fixture of negative_fixtures) {
		expect(diagnostics, `missing diagnostic for ${fixture}`).toContain(fixture);
	}
}, 180_000);

function prepare_types_workspace(): Promise<string> {
	workspace_promise ??= make_types_workspace();

	return workspace_promise;
}

async function make_types_workspace(): Promise<string> {
	const artifact = await ensure_packed_artifact();
	const versions = await read_primary_dependency_versions();
	const workspace = await prepare_workspace("types", artifact, {
		name: "ser-packed-type-contracts",
		private: true,
		type: "module",
		dependencies: versions,
	});
	const contracts_root = join(workspace, "contracts");

	await mkdir(contracts_root, { recursive: true });
	await cp(fixture_root, contracts_root, { recursive: true });

	return workspace;
}

async function write_tsconfig(workspace: string, files: readonly string[]): Promise<string> {
	const path = join(workspace, `tsconfig-${files[0]?.replace(".ts", "")}.json`);
	const tsconfig = {
		compilerOptions: {
			exactOptionalPropertyTypes: true,
			lib: ["dom", "dom.iterable", "es2022"],
			module: "nodenext",
			moduleResolution: "nodenext",
			noEmit: true,
			noUncheckedIndexedAccess: true,
			skipLibCheck: true,
			strict: true,
			target: "es2022",
			types: ["node"],
		},
		files: files.map((file) => `./contracts/${file}`),
	};

	await writeFile(path, `${JSON.stringify(tsconfig, null, 2)}\n`);

	return path;
}
