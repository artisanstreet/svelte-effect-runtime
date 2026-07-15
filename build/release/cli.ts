import { create_artifact_manifest, validate_artifact_manifest } from "./artifact-manifest.ts";
import {
	ReadArtifactManifest,
	ReadCanonicalReleasePlan,
	ReadPackageVersions,
	ReadPlannedArtifacts,
	ReadPreviousPackageVersions,
	WriteGithubOutput,
	WriteJsonFile,
} from "./io.ts";
import { plan_release } from "./policy.ts";
import { RepoRoot } from "../node-utils.ts";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { pathToFileURL } from "node:url";

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const CommitSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-fA-F]{40}$/)));
const BeforeCommitSchema = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[0-9a-fA-F]{40,64}$/)),
);
const PlanRequestSchema = Schema.Struct({
	command: Schema.Literals(["plan"] as const),
	event: Schema.Literals(["pull_request", "push", "workflow_dispatch"] as const),
	ref: NonEmptyStringSchema,
	commit: CommitSchema,
	before: Schema.optional(BeforeCommitSchema),
	resume_version: Schema.optional(NonEmptyStringSchema),
	resume_commit: Schema.optional(CommitSchema),
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

export type CliEnvironment = Readonly<Record<string, string | undefined>>;
export type CliRequest =
	| typeof PlanRequestSchema.Type
	| typeof ManifestRequestSchema.Type
	| typeof ValidateRequestSchema.Type;

const command_flags = {
	plan: new Set([
		"event",
		"ref",
		"commit",
		"before",
		"resume-version",
		"resume-commit",
		"output",
		"github-output",
	]),
	manifest: new Set(["plan", "artifact-dir", "output"]),
	validate: new Set(["plan", "manifest", "artifact-dir"]),
} as const;

export function parse_cli_request(
	args: ReadonlyArray<string>,
	environment: CliEnvironment = process.env,
): CliRequest {
	const command = args[0];

	if (command !== "plan" && command !== "manifest" && command !== "validate") {
		throw new Error(
			`Expected release command plan, manifest, or validate; received ${command ?? "none"}.`,
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

	const request = Schema.decodeUnknownSync(PlanRequestSchema)({
		command,
		event: flags.event ?? environment.GITHUB_EVENT_NAME,
		ref: flags.ref ?? environment.GITHUB_REF,
		commit: flags.commit ?? environment.GITHUB_SHA,
		before: flags.before ?? environment.GITHUB_EVENT_BEFORE,
		resume_version: flags["resume-version"],
		resume_commit: flags["resume-commit"],
		output: flags.output,
		github_output: flags["github-output"] ?? environment.GITHUB_OUTPUT,
	});
	const has_resume_version = request.resume_version !== undefined;
	const has_resume_commit = request.resume_commit !== undefined;

	if (has_resume_version !== has_resume_commit) {
		throw new Error("Resume requires both --resume-version and --resume-commit.");
	}

	if (has_resume_version && request.event !== "workflow_dispatch") {
		throw new Error("Resume is only available for workflow_dispatch events.");
	}

	if (request.event === "push" && request.ref === "refs/heads/master" && !request.before) {
		throw new Error("A protected-branch push requires --before or GITHUB_EVENT_BEFORE.");
	}

	return request;
}

export const RunReleaseCli = (request: CliRequest) =>
	Effect.gen(function* () {
		const repo_root = yield* RepoRoot;

		if (request.command === "plan") {
			const current_versions = yield* ReadPackageVersions(repo_root);
			const is_protected_push =
				request.event === "push" && request.ref === "refs/heads/master";
			const previous_versions = is_protected_push
				? yield* ReadPreviousPackageVersions(
						repo_root,
						yield* RequirePreviousCommit(request.before),
					)
				: undefined;
			const plan = yield* Effect.try({
				try: () =>
					plan_release({
						event: request.event,
						ref: request.ref,
						commit: request.commit,
						current_versions,
						...(previous_versions ? { previous_versions } : {}),
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

		const plan = yield* ReadCanonicalReleasePlan(request.plan);
		const files = yield* ReadPlannedArtifacts(plan, request.artifact_dir);

		if (request.command === "manifest") {
			const manifest = create_artifact_manifest(plan, files);

			yield* WriteJsonFile(request.output, manifest);

			return manifest;
		}

		const manifest = yield* ReadArtifactManifest(request.manifest);

		return validate_artifact_manifest(plan, manifest, files);
	});

const RequirePreviousCommit = (before: string | undefined) =>
	before
		? Effect.succeed(before)
		: Effect.fail(new Error("A protected-branch push requires its previous commit."));

const Main = Effect.gen(function* () {
	const request = yield* Effect.try({
		try: () => parse_cli_request(process.argv.slice(2), process.env),
		catch: (cause) => cause,
	});

	return yield* RunReleaseCli(request);
});

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
