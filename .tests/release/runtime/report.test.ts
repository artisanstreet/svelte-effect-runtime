import {
	calculate_timing_report,
	decode_promotion_evidence,
	format_timing_summary,
	select_release_deployment,
} from "../../../build/ci/report.ts";
import { expect, test } from "vitest";

test("pipeline evidence keeps governance, compute, and provider timing separate", () => {
	const promotion = decode_promotion_evidence({
		commit: "a".repeat(40),
		version: "4.1.0",
		overall: "partial",
		total_provider_ms: 2_500,
		completed_channels: ["npm"],
		pending_channels: ["openvsx", "github-release"],
		channels: {
			npm: { url: "https://www.npmjs.com/package/svelte-effect-runtime/v/4.1.0" },
			openvsx: {},
			"github-release": {},
		},
	});
	const report = calculate_timing_report({
		now_ms: Date.parse("2026-07-15T12:05:00Z"),
		repository: "usebarekey/svelte-effect-runtime",
		run_id: "1234",
		fallback_commit: "b".repeat(40),
		run: {
			created_at: "2026-07-15T12:00:00Z",
			run_started_at: "2026-07-15T12:00:10Z",
			html_url: "https://github.com/usebarekey/svelte-effect-runtime/actions/runs/1234",
		},
		jobs: [
			{
				name: "Authorize release",
				started_at: "2026-07-15T12:00:10Z",
				completed_at: "2026-07-15T12:00:20Z",
			},
			{
				name: "Prepare GitHub release",
				started_at: "2026-07-15T12:00:25Z",
				completed_at: "2026-07-15T12:04:00Z",
			},
		],
		release_deployment: {
			created_at: "2026-07-15T11:58:00Z",
			in_progress_at: "2026-07-15T12:00:10Z",
		},
		recent_runs: [{ conclusion: "success" }, { conclusion: "failure" }],
		plan: { commit: "a".repeat(40), version: "4.1.0", mode: "release" },
		promotion,
		artifacts: [
			{
				name: "svelte-effect-runtime-4.1.0.tgz",
				sha256: "c".repeat(64),
				sha512_sri: "sha512-example",
			},
		],
		phase_provider_ms: [1_500, 2_000],
	});

	expect(report).toMatchObject({
		commit: "a".repeat(40),
		version: "4.1.0",
		workflow_queue_ms: 10_000,
		candidate_commit: "a".repeat(40),
		master_ancestry: "verified",
		approval_wait_ms: 130_000,
		promotion_runner_queue_ms: 5_000,
		active_compute_ms: 225_000,
		provider_ms: 3_500,
		total_wall_ms: 300_000,
		recent_failures: 1,
		recent_runs: 2,
	});
	expect(report.retry_command).toContain("-f resume_run_id=1234");
	expect(format_timing_summary(report)).toContain("Approval wait | 130.0 s");
	expect(format_timing_summary(report)).toContain("svelte-effect-runtime-4.1.0.tgz");
});

test("release deployment evidence belongs to the current workflow run", () => {
	const deployment = select_release_deployment(
		[
			{
				id: 42,
				created_at: "2026-07-15T11:58:00Z",
				statuses_url: "https://api.github.com/repos/example/ser/deployments/42/statuses",
			},
		],
		{
			42: [
				{
					state: "in_progress",
					created_at: "2026-07-15T12:00:10Z",
					log_url: "https://github.com/example/ser/actions/runs/1234/job/99",
				},
			],
		},
		"1234",
	);

	expect(deployment).toEqual({
		created_at: "2026-07-15T11:58:00Z",
		in_progress_at: "2026-07-15T12:00:10Z",
	});
});
