import { compare_observations, find_differences } from "./harness/comparison.ts";
import { make_evidence } from "./harness/evidence.ts";
import { normalize_observation, normalize_value } from "./harness/normalization.ts";
import { get_target, make_targets, parse_target_source } from "./harness/target.ts";
import { get_conformance_browsers } from "./harness/model.ts";
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
	test("keeps native as oracle while stable and candidate remain independent artifacts", () => {
		const targets = make_targets(
			"package:svelte-effect-runtime@4.0.0",
			"artifact:C:/artifacts/candidate.tgz",
		);

		expect(get_target(targets, "native")).toEqual({
			name: "native",
			source: { _tag: "Native" },
			fixture: "native",
		});
		expect(get_target(targets, "stable").source).toEqual({
			_tag: "Package",
			specifier: "svelte-effect-runtime@4.0.0",
		});
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
