import { parse_cli_request, RunReleaseCli } from "../../../build/release/cli.ts";
import { ReadCanonicalReleasePlan, ReadReleaseRepositoryState } from "../../../build/release/io.ts";
import { plan_release } from "../../../build/release/policy.ts";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec_file = promisify(execFile);

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
			"refs/heads/candidate",
			"--commit",
			"a".repeat(40),
			"--mode",
			"resume",
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
			"--mode",
			"release",
			"--output",
			"plan.json",
		]),
	).toThrow(/only available for workflow_dispatch/i);
	expect(() =>
		parse_cli_request([
			"plan",
			"--event",
			"workflow_dispatch",
			"--ref",
			"refs/heads/candidate",
			"--commit",
			"a".repeat(40),
			"--output",
			"plan.json",
		]),
	).toThrow(/requires --mode/i);
	expect(() =>
		parse_cli_request([
			"plan",
			"--event",
			"workflow_dispatch",
			"--ref",
			"refs/heads/master",
			"--commit",
			"a".repeat(40),
			"--mode",
			"release",
			"--output",
			"plan.json",
		]),
	).toThrow(/only allowed from refs\/heads\/candidate/i);
	expect(() =>
		parse_cli_request(
			[
				"promote",
				"--plan",
				"plan.json",
				"--manifest",
				"manifest.json",
				"--artifact-dir",
				"artifacts",
				"--notes",
				"notes.md",
				"--state-output",
				"state.json",
				"--max-attempts",
				"0",
			],
			{ GITHUB_REPOSITORY: "usebarekey/svelte-effect-runtime" },
		),
	).toThrow(/max-attempts must be an integer/i);
});

test("candidate plan parsing accepts only explicit release, dry-run, or resume modes", () => {
	const release = parse_cli_request([
		"plan",
		"--event",
		"workflow_dispatch",
		"--ref",
		"refs/heads/candidate",
		"--commit",
		"a".repeat(40),
		"--mode",
		"release",
		"--output",
		"plan.json",
	]);
	const resume = parse_cli_request([
		"plan",
		"--event",
		"workflow_dispatch",
		"--ref",
		"refs/heads/candidate",
		"--commit",
		"a".repeat(40),
		"--mode",
		"resume",
		"--resume-version",
		"4.1.0",
		"--resume-commit",
		"a".repeat(40),
		"--output",
		"plan.json",
	]);

	expect(release).toMatchObject({ command: "plan", mode: "release" });
	expect(resume).toMatchObject({
		command: "plan",
		mode: "resume",
		resume_version: "4.1.0",
		resume_commit: "a".repeat(40),
	});
});

test("resume validation parsing requires both canonical plan paths", () => {
	const request = parse_cli_request([
		"validate-resume",
		"--plan",
		"release-plan.json",
		"--source-plan",
		"source-plan.json",
	]);

	expect(request).toEqual({
		command: "validate-resume",
		plan: "release-plan.json",
		source_plan: "source-plan.json",
	});
});

test("release repository state comes from immutable tags and candidate ancestry", async () => {
	const temp_root = await mkdtemp(join(tmpdir(), "ser-release-git-state-"));

	try {
		await exec_file("git", ["init", "--initial-branch=master"], { cwd: temp_root });
		await writeFile(join(temp_root, "fixture.txt"), "candidate\n");
		await exec_file("git", ["add", "fixture.txt"], { cwd: temp_root });
		await exec_file(
			"git",
			[
				"-c",
				"user.name=Release Test",
				"-c",
				"user.email=release@example.test",
				"commit",
				"-m",
				"candidate",
			],
			{ cwd: temp_root },
		);
		const { stdout } = await exec_file("git", ["rev-parse", "HEAD"], { cwd: temp_root });
		const commit = stdout.trim();

		await exec_file("git", ["update-ref", "refs/remotes/origin/master", commit], {
			cwd: temp_root,
		});
		await exec_file("git", ["update-ref", "refs/remotes/origin/candidate", commit], {
			cwd: temp_root,
		});
		await exec_file("git", ["tag", "v4.0.0", commit], { cwd: temp_root });
		await exec_file("git", ["tag", "v3.9.0", commit], { cwd: temp_root });
		await exec_file("git", ["tag", "release-candidate", commit], { cwd: temp_root });
		const state = await RunEffect(ReadReleaseRepositoryState(temp_root, commit, "4.1.0"));
		const plan = plan_release({
			event: "workflow_dispatch",
			ref: "refs/heads/candidate",
			commit,
			current_versions: {
				runtime: "4.1.0",
				grammars: "4.1.0",
				"language-server": "4.1.0",
				vsix: "4.1.0",
			},
			mode: "release",
			repository_state: state,
		});
		const plan_path = join(temp_root, "release-plan.json");

		await writeFile(plan_path, `${JSON.stringify(plan)}\n`);

		expect(state).toEqual({
			candidate_head: commit,
			candidate_is_on_master: true,
			greatest_release_version: "4.0.0",
			current_tag_exists: false,
		});
		await expect(RunEffect(ReadCanonicalReleasePlan(plan_path, temp_root))).resolves.toEqual(
			plan,
		);

		await writeFile(plan_path, `${JSON.stringify({ ...plan, previous_version: "3.9.0" })}\n`);
		await expect(RunEffect(ReadCanonicalReleasePlan(plan_path, temp_root))).rejects.toThrow(
			/canonical release policy/i,
		);
	} finally {
		await rm(temp_root, { recursive: true, force: true });
	}
});

test("promotion CLI flags use explicit bounded defaults", () => {
	const request = parse_cli_request(
		[
			"promote",
			"--plan",
			"plan.json",
			"--manifest",
			"manifest.json",
			"--artifact-dir",
			"artifacts",
			"--notes",
			"notes.md",
			"--state-output",
			"state.json",
			"--dry-run",
			"true",
		],
		{
			GITHUB_REPOSITORY: "usebarekey/svelte-effect-runtime",
			GITHUB_STEP_SUMMARY: "summary.md",
		},
	);

	expect(request).toMatchObject({
		command: "promote",
		repository: "usebarekey/svelte-effect-runtime",
		state_output: "state.json",
		summary_output: "summary.md",
		max_attempts: 12,
		probe_delay_ms: 5_000,
		request_timeout_ms: 15_000,
		command_timeout_ms: 120_000,
		dry_run: true,
	});
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
