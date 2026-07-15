import { copyFile, cp, mkdir, readFile, stat } from "node:fs/promises";
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

const fixture_root = fileURLToPath(new URL("./fixtures/packed-consumer", import.meta.url));
const phases = ["sync", "check:types", "check:ser", "build"] as const;

test("packed SvelteKit consumer completes named sync, type, SER, and build checks", async () => {
	const artifact = await ensure_packed_artifact();
	const versions = await read_primary_dependency_versions();
	const fixture_manifest = JSON.parse(
		await readFile(join(fixture_root, "package.json"), "utf8"),
	) as Readonly<Record<string, unknown>>;
	const workspace = await prepare_workspace("tooling", artifact, {
		...fixture_manifest,
		dependencies: versions,
	});

	await cp(join(fixture_root, "src"), join(workspace, "src"), { recursive: true });
	await copyFile(join(fixture_root, "tsconfig.json"), join(workspace, "tsconfig.json"));
	await copyFile(join(fixture_root, "vite.config.ts"), join(workspace, "vite.config.ts"));
	await mkdir(join(workspace, ".harness"));
	await copyFile(
		join(fixture_root, "..", "..", "..", "consumer", "harness", "check-svelte.ts"),
		join(workspace, ".harness", "check-svelte.ts"),
	);

	for (const phase of phases) {
		const result = run_command("corepack", ["pnpm", "run", phase], workspace);

		assert_command_succeeded(`packed consumer ${phase}`, result);
	}

	await expect(
		stat(join(workspace, ".svelte-kit", "output", "client", ".vite", "manifest.json")),
	).resolves.toBeDefined();
	await expect(
		stat(join(workspace, ".svelte-kit", "output", "server", "index.js")),
	).resolves.toBeDefined();
}, 240_000);
