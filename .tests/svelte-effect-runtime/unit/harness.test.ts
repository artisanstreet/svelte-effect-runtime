import { compare_observations, find_differences } from "./harness/comparison.ts";
import { resolve_git_revision } from "../consumer/harness/prepare.ts";
import { make_evidence } from "./harness/evidence.ts";
import { normalize_observation, normalize_value } from "./harness/normalization.ts";
import {
	get_target,
	make_candidate_artifact_source,
	make_targets,
	parse_target_source,
} from "./harness/target.ts";
import {
	get_conformance_browsers,
	get_conformance_proxy_url,
	get_conformance_target_url,
} from "./harness/model.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

describe("conformance browser selection", () => {
	test("keeps Firefox in broad lanes where Portless TLS is supported", () => {
		expect(get_conformance_browsers("fast", "linux")).toEqual(["chromium"]);
		expect(get_conformance_browsers("broad", "linux")).toEqual([
			"chromium",
			"firefox",
			"webkit",
		]);
		expect(get_conformance_browsers("broad", "win32")).toEqual(["chromium", "webkit"]);
	});
});

describe("conformance target selection", () => {
	test("drives production servers directly while retaining named proxy origins", () => {
		expect(get_conformance_target_url("native")).toBe("http://127.0.0.1:41801");
		expect(get_conformance_proxy_url("native")).toBe(
			"https://ser-conformance-native.localhost:41730",
		);
	});

	test("rejects offsets that overflow the highest conformance port", () => {
		const model_url = new URL("./harness/model.ts", import.meta.url).href;
		const result = spawnSync(
			process.execPath,
			["--input-type=module", "--eval", `await import(${JSON.stringify(model_url)});`],
			{
				encoding: "utf8",
				env: { ...process.env, CONFORMANCE_PORT_OFFSET: "23733" },
			},
		);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(
			"CONFORMANCE_PORT_OFFSET must be an integer between 0 and 23732.",
		);
	});

	test("keeps native as oracle while stable and candidate remain independent artifacts", () => {
		const targets = make_targets(
			"package:svelte-effect-runtime@4.1.0",
			"artifact:C:/artifacts/candidate.tgz",
		);

		expect(get_target(targets, "native")).toEqual({
			name: "native",
			source: { _tag: "Native" },
			fixture: "native",
		});
		expect(get_target(targets, "stable").source).toEqual({
			_tag: "Package",
			specifier: "svelte-effect-runtime@4.1.0",
		});
		expect(get_target(targets, "stable").fixture).toBe("candidate");
		expect(get_target(targets, "candidate").source).toEqual({
			_tag: "Artifact",
			path: "C:/artifacts/candidate.tgz",
		});
	});

	test("accepts Git references without treating them as package aliases", () => {
		expect(parse_target_source("git:origin/effect-native-ser")).toEqual({
			_tag: "Git",
			reference: "origin/effect-native-ser",
		});
	});

	test("derives the candidate artifact from the release version", () => {
		expect(make_candidate_artifact_source("4.0.1")).toBe(
			"artifact:.dist/svelte-effect-runtime/svelte-effect-runtime-4.0.1.tgz",
		);
	});
});

describe("conformance observations", () => {
	test("normalizes only declared volatile transport metadata", () => {
		const normalized = normalize_observation({
			scenario_id: "query-value",
			target: "candidate",
			recorded_at: "2026-07-14T00:00:00.000Z",
			value: {
				endpoint: "http://127.0.0.1:4173/_app/remote\r\n",
				value: "http://product.example:4173/stays-exact",
			},
		});

		expect(normalized.value).toEqual({
			endpoint: "http://127.0.0.1:<port>/_app/remote\n",
			value: "http://product.example:4173/stays-exact",
		});
	});

	test("reports the exact observable path that diverges from native", () => {
		const native = {
			scenario_id: "form-validation",
			target: "native" as const,
			recorded_at: "2026-07-14T00:00:00.000Z",
			value: { issues: [{ path: ["items", 0, "name"], message: "Required" }] },
		};
		const candidate = {
			...native,
			target: "candidate" as const,
			value: { issues: [{ path: ["items", 1, "name"], message: "Required" }] },
		};

		expect(compare_observations(native, candidate)).toMatchObject({
			matches: false,
			differences: [
				{
					path: "$.issues[0].path[1]",
					oracle: 0,
					subject: 1,
				},
			],
		});
	});

	test("reports missing array elements even when the present value is undefined", () => {
		expect(find_differences([undefined], [])).toEqual([
			{
				path: "$.length",
				oracle: 1,
				subject: 0,
			},
		]);
	});

	test("reports missing object properties even when the present value is undefined", () => {
		expect(find_differences({ value: undefined }, {})).toEqual([
			{
				path: "$.value",
				oracle: undefined,
				subject: undefined,
			},
		]);
	});

	test("preserves and compares opaque built-in observations", () => {
		const oracle_date = new Date("2024-01-02T03:04:05.000Z");
		const subject_date = new Date("2025-01-02T03:04:05.000Z");
		const oracle_map = new Map([["answer", 42]]);
		const subject_map = new Map([["answer", 43]]);
		const normalized = normalize_value({ date: oracle_date, map: oracle_map });

		expect(normalized).toEqual({ date: oracle_date, map: oracle_map });
		expect(find_differences(oracle_date, subject_date)).toEqual([
			{ path: "$", oracle: oracle_date, subject: subject_date },
		]);
		expect(find_differences(oracle_map, subject_map)).toEqual([
			{ path: "$", oracle: oracle_map, subject: subject_map },
		]);
	});
});

test("Git targets resolve remote-tracking references before cloning", async () => {
	const repository = await mkdtemp(join(tmpdir(), "ser-git-reference-"));
	const checkout = join(repository, "checkout");

	try {
		run_git(repository, ["init"]);
		run_git(repository, ["config", "user.email", "conformance@example.test"]);
		run_git(repository, ["config", "user.name", "SER Conformance"]);
		await writeFile(join(repository, "fixture.txt"), "fixture\n");
		run_git(repository, ["add", "fixture.txt"]);
		run_git(repository, ["commit", "-m", "test fixture"]);

		const revision = run_git(repository, ["rev-parse", "HEAD"]);

		run_git(repository, ["update-ref", "refs/remotes/origin/effect-native-ser", revision]);
		run_git(repository, ["clone", "--shared", "--no-checkout", repository, checkout]);

		const direct_checkout = spawnSync(
			"git",
			["checkout", "--detach", "origin/effect-native-ser"],
			{
				cwd: checkout,
				encoding: "utf8",
				windowsHide: true,
			},
		);
		const resolved_revision = await resolve_git_revision(
			repository,
			"origin/effect-native-ser",
		);

		expect(direct_checkout.status).not.toBe(0);
		expect(resolved_revision).toBe(revision);

		run_git(checkout, ["checkout", "--detach", resolved_revision]);

		expect(run_git(checkout, ["rev-parse", "HEAD"])).toBe(resolved_revision);
	} finally {
		await rm(repository, { force: true, recursive: true });
	}
});

test("evidence paths cannot escape the run directory", () => {
	const evidence = make_evidence(
		".dist/conformance/evidence",
		"run:42",
		"request isolation",
		"stable",
		"drive",
		"network.json",
		{ artifact_sha256: "abc" },
	);

	expect(evidence).toEqual({
		scenario_id: "request isolation",
		target: "stable",
		phase: "drive",
		path: ".dist/conformance/evidence/run-42/request-isolation/stable/drive/network.json",
		metadata: { artifact_sha256: "abc" },
	});
	expect(() =>
		make_evidence(
			".dist/conformance/evidence",
			"..",
			"request isolation",
			"stable",
			"drive",
			"network.json",
		),
	).toThrow("Invalid evidence path segment: ..");
});

function run_git(cwd: string, arguments_: readonly string[]): string {
	const result = spawnSync("git", arguments_, {
		cwd,
		encoding: "utf8",
		windowsHide: true,
	});

	if (result.status !== 0) {
		throw new Error(`git ${arguments_.join(" ")} failed.\n${result.stdout}${result.stderr}`);
	}

	return result.stdout.trim();
}
