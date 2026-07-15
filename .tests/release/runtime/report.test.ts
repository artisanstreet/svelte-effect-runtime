import {
	calculate_timing_report,
	decode_promotion_evidence,
	format_timing_summary,
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
				name: "Plan",
				started_at: "2026-07-15T12:00:10Z",
				completed_at: "2026-07-15T12:00:30Z",
			},
			{
				name: "Promote release",
				started_at: "2026-07-15T12:03:00Z",
				completed_at: "2026-07-15T12:04:00Z",
			},
		],
		recent_runs: [{ conclusion: "success" }, { conclusion: "failure" }],
		plan: { commit: "a".repeat(40), version: "4.1.0", mode: "release" },
		promotion,
	});

	expect(report).toMatchObject({
		commit: "a".repeat(40),
		version: "4.1.0",
		workflow_queue_ms: 10_000,
		approval_wait_ms: undefined,
		promotion_runner_queue_ms: undefined,
		active_compute_ms: 80_000,
		provider_ms: 2_500,
		total_wall_ms: 300_000,
		recent_failures: 1,
		recent_runs: 2,
	});
	expect(report.retry_command).toContain("-f resume_run_id=1234");
	expect(format_timing_summary(report)).toContain("Approval wait | unavailable");
});
