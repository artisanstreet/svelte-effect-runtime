import {
	AppendTextFile,
	GenerateReleaseNotes,
	ReadArtifactManifest,
	ReadCanonicalReleasePlan,
	ReadPackageVersions,
	ReadPlannedArtifacts,
	ReadReleaseRepositoryState,
	ReadTextFile,
	WriteGithubOutput,
	WriteJsonFile,
	WriteTextFile,
} from "./io.ts";
import {
	format_promotion_summary,
	InspectPromotion,
	PromoteRelease,
	type PromotionOptions,
	type PromotionPhase,
	type PromotionState,
} from "./promotion.ts";
import {
	create_artifact_manifest,
	validate_artifact_manifest,
	type ArtifactManifest,
} from "./artifact-manifest.ts";
import {
	candidate_release_ref,
	plan_release,
	validate_resume_source_plan,
	type ReleasePlan,
} from "./policy.ts";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { ProviderAdaptersLive } from "./provider-adapters.ts";
import { RepoRoot } from "../node-utils.ts";
import { pathToFileURL } from "node:url";
import { Effect, Schema } from "effect";

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const CommitSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-fA-F]{40}$/)));
const RunIdSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[1-9]\d*$/)));
const PlanRequestSchema = Schema.Struct({
	command: Schema.Literals(["plan"] as const),
	event: Schema.Literals(["pull_request", "push", "workflow_dispatch"] as const),
	ref: NonEmptyStringSchema,
	commit: CommitSchema,
	mode: Schema.optional(Schema.Literals(["dry-run", "release", "resume"] as const)),
	resume_version: Schema.optional(NonEmptyStringSchema),
	resume_commit: Schema.optional(CommitSchema),
	resume_run_id: Schema.optional(RunIdSchema),
	output: NonEmptyStringSchema,
	github_output: Schema.optional(NonEmptyStringSchema),
});
const ManifestRequestSchema = Schema.Struct({
	command: Schema.Literals(["manifest"] as const),
	plan: NonEmptyStringSchema,
	artifact_dir: NonEmptyStringSchema,
	output: NonEmptyStringSchema,
});
const ValidateRequestSchema = Schema.Struct({
	command: Schema.Literals(["validate"] as const),
	plan: NonEmptyStringSchema,
	manifest: NonEmptyStringSchema,
	artifact_dir: NonEmptyStringSchema,
});
const NotesRequestSchema = Schema.Struct({
	command: Schema.Literals(["notes"] as const),
	plan: NonEmptyStringSchema,
	repository_url: NonEmptyStringSchema,
	output: NonEmptyStringSchema,
});
const ValidateResumeRequestSchema = Schema.Struct({
	command: Schema.Literals(["validate-resume"] as const),
	plan: NonEmptyStringSchema,
	source_plan: NonEmptyStringSchema,
});
const InspectRequestSchema = Schema.Struct({
	command: Schema.Literals(["inspect"] as const),
	plan: NonEmptyStringSchema,
	manifest: NonEmptyStringSchema,
	artifact_dir: NonEmptyStringSchema,
	notes: NonEmptyStringSchema,
	repository: NonEmptyStringSchema,
	output: NonEmptyStringSchema,
	max_attempts: Schema.Number,
	probe_delay_ms: Schema.Number,
	request_timeout_ms: Schema.Number,
});
const PromoteRequestSchema = Schema.Struct({
	command: Schema.Literals(["promote"] as const),
	plan: NonEmptyStringSchema,
	manifest: NonEmptyStringSchema,
	artifact_dir: NonEmptyStringSchema,
	notes: NonEmptyStringSchema,
	repository: NonEmptyStringSchema,
	state_output: NonEmptyStringSchema,
	summary_output: Schema.optional(NonEmptyStringSchema),
	max_attempts: Schema.Number,
	probe_delay_ms: Schema.Number,
	request_timeout_ms: Schema.Number,
	command_timeout_ms: Schema.Number,
	dry_run: Schema.Boolean,
	phase: Schema.Literals([
		"all",
		"preflight",
		"github-prepare",
		"npm",
		"openvsx",
		"github-assets",
		"github-finalize",
	] as const),
});

export type CliEnvironment = Readonly<Record<string, string | undefined>>;
export type CliRequest =
	| typeof PlanRequestSchema.Type
	| typeof ManifestRequestSchema.Type
	| typeof ValidateRequestSchema.Type
	| typeof ValidateResumeRequestSchema.Type
	| typeof NotesRequestSchema.Type
	| typeof InspectRequestSchema.Type
	| typeof PromoteRequestSchema.Type;

const command_flags = {
	plan: new Set([
		"event",
		"ref",
		"commit",
		"mode",
		"resume-version",
		"resume-commit",
		"resume-run-id",
		"output",
		"github-output",
	]),
	manifest: new Set(["plan", "artifact-dir", "output"]),
	validate: new Set(["plan", "manifest", "artifact-dir"]),
	"validate-resume": new Set(["plan", "source-plan"]),
	notes: new Set(["plan", "repository-url", "output"]),
	inspect: new Set([
		"plan",
		"manifest",
		"artifact-dir",
		"notes",
		"repository",
		"output",
		"max-attempts",
		"probe-delay-ms",
		"request-timeout-ms",
	]),
	promote: new Set([
		"plan",
		"manifest",
		"artifact-dir",
		"notes",
		"repository",
		"state-output",
		"summary-output",
		"max-attempts",
		"probe-delay-ms",
		"request-timeout-ms",
		"command-timeout-ms",
		"dry-run",
		"phase",
	]),
} as const;

export function parse_cli_request(
	args: ReadonlyArray<string>,
	environment: CliEnvironment = process.env,
): CliRequest {
	const command = args[0];

	if (
		command !== "plan" &&
		command !== "manifest" &&
		command !== "validate" &&
		command !== "validate-resume" &&
		command !== "notes" &&
		command !== "inspect" &&
		command !== "promote"
	) {
		throw new Error(
			`Expected release command plan, manifest, validate, validate-resume, notes, inspect, or promote; received ${command ?? "none"}.`,
		);
	}

	const flags = parse_flags(args.slice(1), command_flags[command]);

	if (command === "manifest") {
		return Schema.decodeUnknownSync(ManifestRequestSchema)({
			command,
			plan: flags.plan,
			artifact_dir: flags["artifact-dir"],
			output: flags.output,
		});
	}

	if (command === "validate") {
		return Schema.decodeUnknownSync(ValidateRequestSchema)({
			command,
			plan: flags.plan,
			manifest: flags.manifest,
			artifact_dir: flags["artifact-dir"],
		});
	}

	if (command === "validate-resume") {
		return Schema.decodeUnknownSync(ValidateResumeRequestSchema)({
			command,
			plan: flags.plan,
			source_plan: flags["source-plan"],
		});
	}

	if (command === "notes") {
		return Schema.decodeUnknownSync(NotesRequestSchema)({
			command,
			plan: flags.plan,
			repository_url: flags["repository-url"],
			output: flags.output,
		});
	}

	if (command === "inspect") {
		return Schema.decodeUnknownSync(InspectRequestSchema)({
			command,
			plan: flags.plan,
			manifest: flags.manifest,
			artifact_dir: flags["artifact-dir"],
			notes: flags.notes,
			repository: flags.repository ?? environment.GITHUB_REPOSITORY,
			output: flags.output,
			max_attempts: parse_integer_flag(flags, "max-attempts", 12, 1),
			probe_delay_ms: parse_integer_flag(flags, "probe-delay-ms", 5_000, 0),
			request_timeout_ms: parse_integer_flag(flags, "request-timeout-ms", 15_000, 1),
		});
	}

	if (command === "promote") {
		return Schema.decodeUnknownSync(PromoteRequestSchema)({
			command,
			plan: flags.plan,
			manifest: flags.manifest,
			artifact_dir: flags["artifact-dir"],
			notes: flags.notes,
			repository: flags.repository ?? environment.GITHUB_REPOSITORY,
			state_output: flags["state-output"],
			summary_output: flags["summary-output"] ?? environment.GITHUB_STEP_SUMMARY,
			max_attempts: parse_integer_flag(flags, "max-attempts", 12, 1),
			probe_delay_ms: parse_integer_flag(flags, "probe-delay-ms", 5_000, 0),
			request_timeout_ms: parse_integer_flag(flags, "request-timeout-ms", 15_000, 1),
			command_timeout_ms: parse_integer_flag(flags, "command-timeout-ms", 120_000, 1),
			dry_run: parse_boolean_flag(flags, "dry-run", false),
			phase: parse_promotion_phase(flags.phase),
		});
	}

	const request = Schema.decodeUnknownSync(PlanRequestSchema)({
		command,
		event: flags.event ?? environment.GITHUB_EVENT_NAME,
		ref: flags.ref ?? environment.GITHUB_REF,
		commit: flags.commit ?? environment.GITHUB_SHA,
		mode: flags.mode,
		resume_version: flags["resume-version"],
		resume_commit: flags["resume-commit"],
		resume_run_id: flags["resume-run-id"],
		output: flags.output,
		github_output: flags["github-output"] ?? environment.GITHUB_OUTPUT,
	});
	const has_resume_version = request.resume_version !== undefined;
	const has_resume_commit = request.resume_commit !== undefined;
	const has_resume_run_id = request.resume_run_id !== undefined;
	const has_resume = has_resume_version && has_resume_commit && has_resume_run_id;

	if (has_resume_version !== has_resume_commit || has_resume_version !== has_resume_run_id) {
		throw new Error(
			"Resume requires --resume-version, --resume-commit, and --resume-run-id together.",
		);
	}

	if (request.event !== "workflow_dispatch") {
		if (request.mode || has_resume) {
			throw new Error(
				"Release mode and resume values are only available for workflow_dispatch events.",
			);
		}

		return request;
	}

	if (!request.mode) {
		throw new Error("A workflow_dispatch plan requires --mode dry-run, release, or resume.");
	}

	if (request.ref !== candidate_release_ref) {
		throw new Error(`A workflow_dispatch plan is only allowed from ${candidate_release_ref}.`);
	}

	if (request.mode === "resume" && !has_resume) {
		throw new Error(
			"Resume mode requires --resume-version, --resume-commit, and --resume-run-id.",
		);
	}

	if (request.mode !== "resume" && has_resume) {
		throw new Error("Resume values require --mode resume.");
	}

	return request;
}

export const RunReleaseCli = (request: CliRequest) =>
	Effect.gen(function* () {
		const repo_root = yield* RepoRoot;

		if (request.command === "plan") {
			const current_versions = yield* ReadPackageVersions(repo_root);
			const current_version = current_versions.runtime;
			const repository_state =
				request.event === "workflow_dispatch"
					? yield* ReadReleaseRepositoryState(repo_root, request.commit, current_version)
					: undefined;
			const plan = yield* Effect.try({
				try: () =>
					plan_release({
						event: request.event,
						ref: request.ref,
						commit: request.commit,
						current_versions,
						...(request.mode ? { mode: request.mode } : {}),
						...(repository_state ? { repository_state } : {}),
						...(request.resume_version && request.resume_commit
							? {
									resume: {
										version: request.resume_version,
										commit: request.resume_commit,
									},
								}
							: {}),
					}),
				catch: (cause) => cause,
			});

			yield* WriteJsonFile(request.output, plan);

			if (request.github_output) {
				yield* WriteGithubOutput(request.github_output, plan);
			}

			return plan;
		}

		const plan = yield* ReadCanonicalReleasePlan(
			request.plan,
			uses_live_fresh_start_state(request) ? repo_root : undefined,
		);

		if (request.command === "validate-resume") {
			const source_plan = yield* ReadCanonicalReleasePlan(request.source_plan);

			return yield* Effect.try({
				try: () => validate_resume_source_plan(plan, source_plan),
				catch: (cause) => cause,
			});
		}

		if (request.command === "notes") {
			const notes = yield* GenerateReleaseNotes(repo_root, plan, request.repository_url);

			yield* WriteTextFile(request.output, notes.markdown);

			return notes;
		}

		const files = yield* ReadPlannedArtifacts(plan, request.artifact_dir);

		if (request.command === "manifest") {
			const manifest = create_artifact_manifest(plan, files);

			yield* WriteJsonFile(request.output, manifest);

			return manifest;
		}

		const manifest = yield* ReadArtifactManifest(request.manifest);
		const validated = validate_artifact_manifest(plan, manifest, files);
		const manifest_content = yield* ReadTextFile(request.manifest);
		const canonical_manifest_content = `${JSON.stringify(validated, null, "\t")}\n`;

		if (manifest_content !== canonical_manifest_content) {
			return yield* Effect.fail(
				new Error("Artifact manifest file is not the canonical verified manifest."),
			);
		}

		if (request.command === "validate") {
			return validated;
		}

		const notes = yield* ReadTextFile(request.notes);
		const options = make_promotion_options(request, notes);

		if (request.command === "inspect") {
			const state = yield* InspectPromotion(plan, validated, options).pipe(
				Effect.provide(ProviderAdaptersLive),
			);

			yield* WriteJsonFile(request.output, state);

			return state;
		}

		return yield* PromoteAndPersist(plan, validated, options, request);
	});

const PromoteAndPersist = (
	plan: ReleasePlan,
	manifest: ArtifactManifest,
	options: PromotionOptions,
	request: typeof PromoteRequestSchema.Type,
) =>
	PromoteRelease(plan, manifest, options).pipe(
		Effect.matchEffect({
			onFailure: (cause) =>
				InspectPromotion(plan, manifest, options).pipe(
					Effect.flatMap((state) => PersistPromotionState(state, request)),
					Effect.andThen(Effect.fail(cause)),
				),
			onSuccess: (state) => PersistPromotionState(state, request).pipe(Effect.as(state)),
		}),
		Effect.provide(ProviderAdaptersLive),
	);

const PersistPromotionState = (state: PromotionState, request: typeof PromoteRequestSchema.Type) =>
	Effect.gen(function* () {
		yield* WriteJsonFile(request.state_output, state);

		if (request.summary_output) {
			yield* AppendTextFile(request.summary_output, format_promotion_summary(state));
		}
	});

const Main = Effect.gen(function* () {
	const request = yield* Effect.try({
		try: () => parse_cli_request(process.argv.slice(2), process.env),
		catch: (cause) => cause,
	});

	return yield* RunReleaseCli(request);
});

function make_promotion_options(
	request: typeof InspectRequestSchema.Type | typeof PromoteRequestSchema.Type,
	notes: string,
): PromotionOptions {
	return {
		repository: request.repository,
		artifact_dir: request.artifact_dir,
		manifest_path: request.manifest,
		notes,
		max_attempts: request.max_attempts,
		probe_delay_ms: request.probe_delay_ms,
		request_timeout_ms: request.request_timeout_ms,
		command_timeout_ms: request.command === "promote" ? request.command_timeout_ms : 120_000,
		dry_run: request.command === "promote" ? request.dry_run : false,
		phase: request.command === "promote" ? request.phase : "preflight",
	};
}

function uses_live_fresh_start_state(request: Exclude<CliRequest, { command: "plan" }>): boolean {
	if (request.command === "inspect") {
		return false;
	}

	if (request.command === "promote") {
		return request.phase === "all" || request.phase === "github-prepare";
	}

	return true;
}

function parse_promotion_phase(value: string | undefined): PromotionPhase {
	const phase = value ?? "all";
	const phases: ReadonlyArray<PromotionPhase> = [
		"all",
		"preflight",
		"github-prepare",
		"npm",
		"openvsx",
		"github-assets",
		"github-finalize",
	];

	if (!phases.includes(phase as PromotionPhase)) {
		throw new Error(`Unknown promotion phase ${phase}.`);
	}

	return phase as PromotionPhase;
}

function parse_integer_flag(
	flags: Readonly<Record<string, string>>,
	name: string,
	default_value: number,
	minimum: number,
): number {
	const raw = flags[name];
	const value = raw === undefined ? default_value : Number(raw);

	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(
			`Argument --${name} must be an integer greater than or equal to ${minimum}.`,
		);
	}

	return value;
}

function parse_boolean_flag(
	flags: Readonly<Record<string, string>>,
	name: string,
	default_value: boolean,
): boolean {
	const raw = flags[name];

	if (raw === undefined) {
		return default_value;
	}

	if (raw === "true") {
		return true;
	}

	if (raw === "false") {
		return false;
	}

	throw new Error(`Argument --${name} must be true or false.`);
}

function parse_flags(
	args: ReadonlyArray<string>,
	allowed_flags: ReadonlySet<string>,
): Record<string, string> {
	const flags: Record<string, string> = {};

	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		const name = flag?.startsWith("--") ? flag.slice(2) : undefined;

		if (!name || !allowed_flags.has(name)) {
			throw new Error(`Unknown argument ${flag ?? "none"}.`);
		}

		if (!value || value.startsWith("--")) {
			throw new Error(`Argument --${name} requires a value.`);
		}

		if (flags[name] !== undefined) {
			throw new Error(`Argument --${name} was supplied more than once.`);
		}

		flags[name] = value;
	}

	return flags;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
}
