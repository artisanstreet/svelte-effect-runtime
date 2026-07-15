import { parse_cli_request, RunReleaseCli } from "../../../build/release/cli.ts";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("CLI parsing rejects unknown, incomplete, and unsafe release configuration", () => {
	expect(() => parse_cli_request(["unknown"])).toThrow(/expected release command/i);
	expect(() =>
		parse_cli_request([
			"manifest",
			"--plan",
			"plan.json",
			"--artifact-dir",
			"artifacts",
			"--output",
			"manifest.json",
			"--search",
			"recursive",
		]),
	).toThrow(/unknown argument --search/i);
	expect(() =>
		parse_cli_request([
			"plan",
			"--event",
			"workflow_dispatch",
			"--ref",
			"refs/heads/master",
			"--commit",
			"a".repeat(40),
			"--resume-version",
			"4.0.0",
			"--output",
			"plan.json",
		]),
	).toThrow(/resume requires both/i);
	expect(() =>
		parse_cli_request([
			"plan",
			"--event",
			"push",
			"--ref",
			"refs/heads/master",
			"--commit",
			"a".repeat(40),
			"--output",
			"plan.json",
		]),
	).toThrow(/protected-branch push requires/i);
});

test("plan, manifest, and validate share exact canonical artifacts on disk", async () => {
	const temp_root = await mkdtemp(join(tmpdir(), "ser-release-cli-"));
	const artifact_dir = join(temp_root, "artifacts");
	const plan_path = join(temp_root, "release-plan.json");
	const manifest_path = join(temp_root, "artifact-manifest.json");
	const github_output_path = join(temp_root, "github-output.txt");

	try {
		await mkdir(artifact_dir);

		const plan_request = parse_cli_request([
			"plan",
			"--event",
			"pull_request",
			"--ref",
			"refs/pull/29/merge",
			"--commit",
			"abcdef0123456789abcdef0123456789abcdef01",
			"--output",
			plan_path,
			"--github-output",
			github_output_path,
		]);
		const plan = await RunEffect(RunReleaseCli(plan_request));

		for (const pkg of plan.packages) {
			await writeFile(join(artifact_dir, pkg.artifact_name), `${pkg.id} bytes`);
		}

		const serialized_plan = JSON.parse(await readFile(plan_path, "utf8"));

		serialized_plan.channels = ["marketplace", "jsr"];
		serialized_plan.packages = [
			{
				id: "runtime",
				artifact_name: "../outside.tgz",
			},
		];
		await writeFile(plan_path, `${JSON.stringify(serialized_plan)}\n`);

		const manifest_request = parse_cli_request([
			"manifest",
			"--plan",
			plan_path,
			"--artifact-dir",
			artifact_dir,
			"--output",
			manifest_path,
		]);
		const manifest = await RunEffect(RunReleaseCli(manifest_request));
		const validate_request = parse_cli_request([
			"validate",
			"--plan",
			plan_path,
			"--manifest",
			manifest_path,
			"--artifact-dir",
			artifact_dir,
		]);
		const validated = await RunEffect(RunReleaseCli(validate_request));
		const github_output = await readFile(github_output_path, "utf8");

		expect(plan.publish).toBe(false);
		expect(manifest.artifacts.map((artifact) => artifact.name)).toEqual(
			plan.packages.map((pkg) => pkg.artifact_name),
		);
		expect(validated).toEqual(manifest);
		expect(github_output).toContain("release_required=false\n");
		expect(github_output).toContain(`artifact_name_vsix=${plan.packages[3].artifact_name}\n`);
	} finally {
		await rm(temp_root, { recursive: true, force: true });
	}
});

function RunEffect<A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> {
	return Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
}
