import {
	plan_release,
	release_package_ids,
	type PackageVersions,
	type ReleasePlan,
	type ReleaseRepositoryState,
} from "./policy.ts";
import {
	ArtifactManifestSchema,
	type ArtifactInput,
	type ArtifactManifest,
} from "./artifact-manifest.ts";
import {
	plan_release_notes,
	select_previous_release_tag,
	type ReleaseCommit,
} from "./release-notes.ts";
import { compare_semantic_versions, parse_release_tag } from "./semantic-version.ts";
import { Effect, FileSystem, Path, Schema } from "effect";
import { RunCommand } from "../node-utils.ts";

const PackageManifestSchema = Schema.Struct({ version: Schema.String });
const ReleaseEventSchema = Schema.Literals(["pull_request", "push", "workflow_dispatch"] as const);
const ReleaseIntentSchema = Schema.Literals(["verify", "publish", "resume"] as const);
const ReleaseModeSchema = Schema.Literals(["dry-run", "release", "resume"] as const);
const SerializedReleasePlanSchema = Schema.Struct({
	event: ReleaseEventSchema,
	ref: Schema.String,
	commit: Schema.String,
	mode: Schema.optional(ReleaseModeSchema),
	version: Schema.String,
	previous_version: Schema.optional(Schema.String),
	tag: Schema.String,
	intent: ReleaseIntentSchema,
	publish: Schema.Boolean,
	dry_run: Schema.Boolean,
	version_changed: Schema.Boolean,
});

export const package_manifest_paths = {
	runtime: "modules/svelte-effect-runtime/package.json",
	grammars: "modules/svelte-effect-runtime-grammars/package.json",
	"language-server": "modules/svelte-effect-runtime-language-server/package.json",
	vsix: "modules/svelte-effect-runtime-vsix/package.json",
} as const;

export const ReadPackageVersions = (repo_root: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const entries = yield* Effect.all(
			release_package_ids.map((package_id) =>
				Effect.gen(function* () {
					const manifest_path = path.join(repo_root, package_manifest_paths[package_id]);
					const content = yield* file_system.readFileString(manifest_path);
					const manifest = yield* DecodeJson(content, PackageManifestSchema);

					return [package_id, manifest.version] as const;
				}),
			),
		);

		return Object.fromEntries(entries) as PackageVersions;
	});

export const ReadReleaseRepositoryState = (repo_root: string, version: string) =>
	Effect.gen(function* () {
		const candidate_output = yield* RunCommand(
			"git",
			["rev-parse", "--verify", "refs/remotes/origin/candidate^{commit}"],
			repo_root,
		);
		const candidate_head = candidate_output.stdout.trim();
		const [master_output, tag_output] = yield* Effect.all(
			[
				RunCommand(
					"git",
					[
						"for-each-ref",
						`--contains=${candidate_head}`,
						"--format=%(refname)",
						"refs/remotes/origin/master",
					],
					repo_root,
				),
				RunCommand("git", ["tag", "--list", "v*"], repo_root),
			] as const,
			{ concurrency: "unbounded" },
		);
		const tags = tag_output.stdout.split(/\r?\n/).filter(Boolean);
		const versions = tags
			.map(parse_release_tag)
			.filter((release_version): release_version is string => release_version !== undefined)
			.sort(compare_semantic_versions);
		const greatest_release_version = versions.at(-1);
		const candidate_is_on_master = master_output.stdout
			.split(/\r?\n/)
			.includes("refs/remotes/origin/master");

		return {
			candidate_head,
			candidate_is_on_master,
			greatest_release_version,
			current_tag_exists: tags.includes(`v${version}`),
		} satisfies ReleaseRepositoryState;
	});

export const ReadCanonicalReleasePlan = (plan_path: string, repo_root?: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const content = yield* file_system.readFileString(plan_path);
		const serialized = yield* DecodeJson(content, SerializedReleasePlanSchema);
		const mode = resolve_serialized_mode(serialized);
		const repository_state =
			mode && repo_root
				? yield* ReadReleaseRepositoryState(repo_root, serialized.version)
				: undefined;

		return yield* Effect.try({
			try: () => canonicalize_release_plan(serialized, repository_state),
			catch: (cause) => cause,
		});
	});

export const ReadArtifactManifest = (manifest_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const content = yield* file_system.readFileString(manifest_path);

		return (yield* DecodeJson(content, ArtifactManifestSchema)) as ArtifactManifest;
	});

export const ReadTextFile = (input_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		return yield* file_system.readFileString(input_path);
	});

export const ReadPlannedArtifacts = (plan: ReleasePlan, artifact_dir: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const files = yield* Effect.all(
			plan.packages.map((pkg) =>
				Effect.gen(function* () {
					const artifact_path = path.join(artifact_dir, pkg.artifact_name);
					const bytes = yield* file_system.readFile(artifact_path);

					return { name: pkg.artifact_name, bytes } satisfies ArtifactInput;
				}),
			),
		);

		return files;
	});

export const WriteJsonFile = (output_path: string, value: unknown) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const parent_dir = path.dirname(output_path);
		const content = `${JSON.stringify(value, null, "\t")}\n`;

		yield* file_system.makeDirectory(parent_dir, { recursive: true });
		yield* file_system.writeFileString(output_path, content);
	});

export const WriteTextFile = (output_path: string, content: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const parent_dir = path.dirname(output_path);

		yield* file_system.makeDirectory(parent_dir, { recursive: true });
		yield* file_system.writeFileString(output_path, content);
	});

export const AppendTextFile = (output_path: string, content: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const parent_dir = path.dirname(output_path);

		yield* file_system.makeDirectory(parent_dir, { recursive: true });
		yield* file_system.writeFileString(output_path, content, { flag: "a" });
	});

export const GenerateReleaseNotes = (
	repo_root: string,
	plan: ReleasePlan,
	repository_url: string,
) =>
	Effect.gen(function* () {
		const tag_output = yield* RunCommand("git", ["tag", "--list"], repo_root);
		const tags = tag_output.stdout.split(/\r?\n/).filter(Boolean);
		const previous_tag = select_previous_release_tag(plan, tags);
		const range = previous_tag ? `${previous_tag}..${plan.commit}` : plan.commit;
		const commit_output = yield* RunCommand(
			"git",
			["log", "--format=%H%x09%s", range],
			repo_root,
		);
		const commits = parse_release_commits(commit_output.stdout);

		return plan_release_notes({ plan, tags, commits, repository_url });
	});

export const WriteGithubOutput = (output_path: string, plan: ReleasePlan) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const artifact_lines = plan.packages.map(
			(pkg) => `artifact_name_${pkg.id.replaceAll("-", "_")}=${pkg.artifact_name}`,
		);
		const content = [
			`release_required=${plan.publish}`,
			`version=${plan.version}`,
			`tag=${plan.tag}`,
			...artifact_lines,
			"",
		].join("\n");

		yield* file_system.writeFileString(output_path, content, { flag: "a" });
	});

const DecodeJson = <S extends Schema.Top>(content: string, schema: S) =>
	Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(content);

function canonicalize_release_plan(
	serialized: typeof SerializedReleasePlanSchema.Type,
	verified_repository_state?: ReleaseRepositoryState,
): ReleasePlan {
	const current_versions = make_package_versions(serialized.version);
	const mode = resolve_serialized_mode(serialized);
	const repository_state =
		verified_repository_state ??
		(mode
			? {
					candidate_head: serialized.commit,
					candidate_is_on_master: true,
					greatest_release_version: serialized.previous_version,
					current_tag_exists: false,
				}
			: undefined);
	const plan = plan_release({
		event: serialized.event,
		ref: serialized.ref,
		commit: serialized.commit,
		...(mode === "resume" && repository_state
			? { execution_commit: repository_state.candidate_head }
			: {}),
		current_versions,
		...(mode ? { mode } : {}),
		...(repository_state ? { repository_state } : {}),
		...(mode === "resume"
			? { resume: { version: serialized.version, commit: serialized.commit } }
			: {}),
	});
	const claims_match =
		plan.mode === serialized.mode &&
		plan.previous_version === serialized.previous_version &&
		plan.tag === serialized.tag &&
		plan.intent === serialized.intent &&
		plan.publish === serialized.publish &&
		plan.dry_run === serialized.dry_run &&
		plan.version_changed === serialized.version_changed;

	if (!claims_match) {
		throw new Error("Serialized release plan does not match canonical release policy.");
	}

	return plan;
}

function resolve_serialized_mode(
	serialized: typeof SerializedReleasePlanSchema.Type,
): typeof ReleaseModeSchema.Type | undefined {
	if (serialized.intent === "resume") {
		return "resume";
	}

	if (serialized.publish) {
		return "release";
	}

	if (serialized.dry_run) {
		return "dry-run";
	}

	return undefined;
}

function make_package_versions(version: string): PackageVersions {
	return {
		runtime: version,
		grammars: version,
		"language-server": version,
		vsix: version,
	};
}

function parse_release_commits(output: string): ReadonlyArray<ReleaseCommit> {
	return output
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const separator = line.indexOf("\t");

			if (separator < 1) {
				throw new Error(`Unable to parse release commit: ${line}`);
			}

			return {
				sha: line.slice(0, separator),
				subject: line.slice(separator + 1),
			};
		});
}
