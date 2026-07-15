import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema } from "effect";
import { pathToFileURL } from "node:url";

export type TimingReport = {
	readonly schema_version: 1;
	readonly run_url: string | undefined;
	readonly commit: string;
	readonly version: string | undefined;
	readonly workflow_queue_ms: number | undefined;
	readonly approval_wait_ms: number | undefined;
	readonly promotion_runner_queue_ms: number | undefined;
	readonly active_compute_ms: number | undefined;
	readonly provider_ms: number | undefined;
	readonly total_wall_ms: number | undefined;
	readonly completed_channels: ReadonlyArray<string>;
	readonly pending_channels: ReadonlyArray<string>;
	readonly channel_urls: Readonly<Record<string, string>>;
	readonly recent_failures: number | undefined;
	readonly recent_runs: number | undefined;
	readonly retry_command: string | undefined;
};

export type TimingReportInput = {
	readonly now_ms: number;
	readonly repository: string;
	readonly run_id: string;
	readonly fallback_commit: string;
	readonly run: GithubRun | undefined;
	readonly jobs: ReadonlyArray<GithubJob> | undefined;
	readonly recent_runs: ReadonlyArray<GithubWorkflowRun> | undefined;
	readonly plan: ReleasePlanEvidence | undefined;
	readonly promotion: PromotionEvidence | undefined;
};

export type GithubRun = {
	readonly created_at: string;
	readonly run_started_at: string;
	readonly html_url: string;
};

export type GithubJob = {
	readonly name: string;
	readonly started_at: string | null | undefined;
	readonly completed_at: string | null | undefined;
};

export type GithubWorkflowRun = {
	readonly conclusion: string | null | undefined;
};

export type ReleasePlanEvidence = {
	readonly commit: string;
	readonly version: string;
	readonly mode?: string | undefined;
};

export type PromotionEvidence = {
	readonly commit: string;
	readonly version: string;
	readonly overall: string;
	readonly total_provider_ms: number;
	readonly completed_channels: ReadonlyArray<string>;
	readonly pending_channels: ReadonlyArray<string>;
	readonly channel_urls: Readonly<Record<string, string>>;
};

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const OptionalTimestampSchema = Schema.NullOr(Schema.String);
const GithubRunSchema = Schema.Struct({
	created_at: NonEmptyStringSchema,
	run_started_at: NonEmptyStringSchema,
	html_url: NonEmptyStringSchema,
});
const GithubJobSchema = Schema.Struct({
	name: NonEmptyStringSchema,
	started_at: OptionalTimestampSchema,
	completed_at: OptionalTimestampSchema,
});
const GithubJobsSchema = Schema.Struct({ jobs: Schema.Array(GithubJobSchema) });
const GithubWorkflowRunSchema = Schema.Struct({ conclusion: Schema.NullOr(Schema.String) });
const GithubWorkflowRunsSchema = Schema.Struct({
	workflow_runs: Schema.Array(GithubWorkflowRunSchema),
});
const ReleasePlanEvidenceSchema = Schema.Struct({
	commit: NonEmptyStringSchema,
	version: NonEmptyStringSchema,
	mode: Schema.optional(Schema.String),
});
const PromotionChannelSchema = Schema.Struct({
	url: Schema.optional(Schema.String),
});
const PromotionEvidenceSchema = Schema.Struct({
	commit: NonEmptyStringSchema,
	version: NonEmptyStringSchema,
	overall: NonEmptyStringSchema,
	total_provider_ms: Schema.Number,
	completed_channels: Schema.Array(Schema.String),
	pending_channels: Schema.Array(Schema.String),
	channels: Schema.Record(Schema.String, PromotionChannelSchema),
});

export function calculate_timing_report(input: TimingReportInput): TimingReport {
	const run_created_ms = input.run ? parse_time(input.run.created_at) : undefined;
	const run_started_ms = input.run ? parse_time(input.run.run_started_at) : undefined;
	const active_compute_ms = input.jobs
		? input.jobs.reduce((total, job) => total + job_duration_ms(job), 0)
		: undefined;
	const recent_failures = input.recent_runs
		? input.recent_runs.filter((run) => run.conclusion === "failure").length
		: undefined;
	const promotion = input.promotion;
	const plan = input.plan;

	return Object.freeze({
		schema_version: 1,
		run_url: input.run?.html_url,
		commit: promotion?.commit ?? plan?.commit ?? input.fallback_commit,
		version: promotion?.version ?? plan?.version,
		workflow_queue_ms:
			run_created_ms !== undefined && run_started_ms !== undefined
				? Math.max(0, run_started_ms - run_created_ms)
				: undefined,
		approval_wait_ms: undefined,
		promotion_runner_queue_ms: undefined,
		active_compute_ms,
		provider_ms: promotion?.total_provider_ms,
		total_wall_ms:
			run_created_ms !== undefined ? Math.max(0, input.now_ms - run_created_ms) : undefined,
		completed_channels: Object.freeze([...(promotion?.completed_channels ?? [])]),
		pending_channels: Object.freeze([...(promotion?.pending_channels ?? [])]),
		channel_urls: Object.freeze({ ...promotion?.channel_urls }),
		recent_failures,
		recent_runs: input.recent_runs?.length,
		retry_command: make_retry_command(input.repository, input.run_id, promotion),
	});
}

export function format_timing_summary(report: TimingReport): string {
	const channel_rows = Object.entries(report.channel_urls).map(
		([channel, url]) => `| ${channel} | [open](${url}) |`,
	);
	const recent =
		report.recent_failures !== undefined && report.recent_runs !== undefined
			? `${report.recent_failures}/${report.recent_runs}`
			: "unavailable";

	return [
		"## SER pipeline evidence",
		"",
		`**Commit:** \`${report.commit}\``,
		"",
		`**Version:** ${report.version ?? "not a candidate run"}`,
		"",
		"| Timing category | Duration |",
		"| --- | ---: |",
		`| Workflow queue | ${format_duration(report.workflow_queue_ms)} |`,
		`| Approval wait | ${format_duration(report.approval_wait_ms)} |`,
		`| Promotion runner queue | ${format_duration(report.promotion_runner_queue_ms)} |`,
		`| Active compute | ${format_duration(report.active_compute_ms)} |`,
		`| External providers | ${format_duration(report.provider_ms)} |`,
		`| Total wall time | ${format_duration(report.total_wall_ms)} |`,
		"",
		`**Recent workflow failures:** ${recent}`,
		"",
		`**Completed channels:** ${report.completed_channels.join(", ") || "none"}`,
		"",
		`**Pending channels:** ${report.pending_channels.join(", ") || "none"}`,
		...(channel_rows.length > 0
			? ["", "| Channel | Result |", "| --- | --- |", ...channel_rows]
			: []),
		...(report.retry_command
			? ["", "**Exact retry:**", "", `\`${report.retry_command}\``]
			: []),
		"",
	].join("\n");
}

export function decode_promotion_evidence(input: unknown): PromotionEvidence {
	const decoded = Schema.decodeUnknownSync(PromotionEvidenceSchema)(input);
	const channel_urls = Object.fromEntries(
		Object.entries(decoded.channels)
			.filter((entry): entry is [string, { readonly url: string }] => Boolean(entry[1].url))
			.map(([channel, state]) => [channel, state.url]),
	);

	return {
		commit: decoded.commit,
		version: decoded.version,
		overall: decoded.overall,
		total_provider_ms: decoded.total_provider_ms,
		completed_channels: decoded.completed_channels,
		pending_channels: decoded.pending_channels,
		channel_urls,
	};
}

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const request = parse_request(process.argv.slice(2));
	const repository = require_environment("GITHUB_REPOSITORY");
	const run_id = require_environment("GITHUB_RUN_ID");
	const api_url = require_environment("GITHUB_API_URL");
	const token = require_environment("GH_TOKEN");
	const fallback_commit = require_environment("GITHUB_SHA");
	const headers = {
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${token}`,
		"X-GitHub-Api-Version": "2022-11-28",
	};
	const [run, jobs, recent_runs, plan, promotion] = yield* Effect.all(
		[
			FetchGithubJson(`${api_url}/repos/${repository}/actions/runs/${run_id}`, headers).pipe(
				DecodeOptional(GithubRunSchema),
			),
			FetchGithubJson(
				`${api_url}/repos/${repository}/actions/runs/${run_id}/jobs?per_page=100`,
				headers,
			).pipe(
				DecodeOptional(GithubJobsSchema),
				Effect.map((result) => result?.jobs),
			),
			FetchGithubJson(
				`${api_url}/repos/${repository}/actions/workflows/ci.yml/runs?per_page=20`,
				headers,
			).pipe(
				DecodeOptional(GithubWorkflowRunsSchema),
				Effect.map((result) => result?.workflow_runs),
			),
			ReadOptionalPlan(request.plan),
			ReadOptionalPromotion(request.state),
		] as const,
		{ concurrency: "unbounded" },
	);
	const report = calculate_timing_report({
		now_ms: Date.now(),
		repository,
		run_id,
		fallback_commit,
		run,
		jobs,
		recent_runs,
		plan,
		promotion,
	});
	const output_content = `${JSON.stringify(report, null, "\t")}\n`;
	const output_dir = path.dirname(request.output);

	yield* file_system.makeDirectory(output_dir, { recursive: true });
	yield* file_system.writeFileString(request.output, output_content);

	const summary_path = process.env.GITHUB_STEP_SUMMARY;

	if (summary_path) {
		yield* file_system.writeFileString(summary_path, format_timing_summary(report), {
			flag: "a",
		});
	}
});

const FetchGithubJson = (url: string, headers: Readonly<Record<string, string>>) =>
	Effect.tryPromise({
		try: async () => {
			const response = await fetch(url, {
				headers,
				signal: AbortSignal.timeout(15_000),
			});

			if (!response.ok) {
				throw new Error(`GitHub API returned ${response.status} for ${url}.`);
			}

			return (await response.json()) as unknown;
		},
		catch: (cause) => cause,
	}).pipe(Effect.catch(() => Effect.succeed(undefined)));

const DecodeOptional = <S extends Schema.Top>(schema: S) =>
	Effect.flatMap((value: unknown | undefined) =>
		value === undefined
			? Effect.succeed(undefined)
			: Schema.decodeUnknownEffect(schema)(value).pipe(
					Effect.catch(() => Effect.succeed(undefined)),
				),
	);

const ReadOptionalPromotion = (input_path: string) =>
	ReadOptionalUnknownJson(input_path).pipe(
		Effect.flatMap((value) =>
			value === undefined
				? Effect.succeed(undefined)
				: Effect.try({
						try: () => decode_promotion_evidence(value),
						catch: (cause) => cause,
					}).pipe(Effect.catch(() => Effect.succeed(undefined))),
		),
	);

const ReadOptionalPlan = (input_path: string) =>
	ReadOptionalUnknownJson(input_path).pipe(
		Effect.flatMap((value) =>
			value === undefined
				? Effect.succeed(undefined)
				: Schema.decodeUnknownEffect(ReleasePlanEvidenceSchema)(value).pipe(
						Effect.catch(() => Effect.succeed(undefined)),
					),
		),
	);

const ReadOptionalUnknownJson = (input_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const exists = yield* file_system.exists(input_path);

		if (!exists) {
			return undefined;
		}

		const content = yield* file_system.readFileString(input_path);

		return yield* Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: (cause) => cause,
		});
	});

function parse_request(args: ReadonlyArray<string>): {
	state: string;
	plan: string;
	output: string;
} {
	const flags = Object.fromEntries(
		Array.from({ length: Math.ceil(args.length / 2) }, (_, index) => {
			const flag = args[index * 2];
			const value = args[index * 2 + 1];

			if (!flag?.startsWith("--") || !value) {
				throw new Error("Report arguments must be --name value pairs.");
			}

			return [flag.slice(2), value];
		}),
	);
	const state = flags.state;
	const plan = flags.plan;
	const output = flags.output;

	if (!state || !plan || !output) {
		throw new Error("Report requires --state, --plan, and --output.");
	}

	return { state, plan, output };
}

function make_retry_command(
	repository: string,
	run_id: string,
	promotion: PromotionEvidence | undefined,
): string | undefined {
	if (!promotion || promotion.overall === "complete" || promotion.overall === "dry-run") {
		return undefined;
	}

	return [
		"gh workflow run ci.yml",
		`--repo ${repository}`,
		"--ref candidate",
		"-f mode=resume",
		`-f resume_version=${promotion.version}`,
		`-f resume_commit=${promotion.commit}`,
		`-f resume_run_id=${run_id}`,
	].join(" ");
}

function job_duration_ms(job: GithubJob): number {
	const started = job.started_at ? parse_time(job.started_at) : undefined;
	const completed = job.completed_at ? parse_time(job.completed_at) : undefined;

	return started !== undefined && completed !== undefined ? Math.max(0, completed - started) : 0;
}

function parse_time(value: string): number | undefined {
	const parsed = Date.parse(value);

	return Number.isFinite(parsed) ? parsed : undefined;
}

function format_duration(duration_ms: number | undefined): string {
	return duration_ms === undefined ? "unavailable" : `${(duration_ms / 1_000).toFixed(1)} s`;
}

function require_environment(name: string): string {
	const value = process.env[name]?.trim();

	if (!value) {
		throw new Error(`${name} is required.`);
	}

	return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
}
