import {
	ArtifactManifestSchema,
	type ArtifactInput,
	type ArtifactManifest,
} from "./artifact-manifest.ts";
import {
	plan_release,
	release_package_ids,
	type PackageVersions,
	type ReleasePlan,
} from "./policy.ts";
import { RunCommand } from "../node-utils.ts";
import { Effect, FileSystem, Path, Schema } from "effect";

const PackageManifestSchema = Schema.Struct({ version: Schema.String });
const ReleaseEventSchema = Schema.Literals(["pull_request", "push", "workflow_dispatch"] as const);
const ReleaseIntentSchema = Schema.Literals(["verify", "publish", "resume"] as const);
const SerializedReleasePlanSchema = Schema.Struct({
	event: ReleaseEventSchema,
	ref: Schema.String,
	commit: Schema.String,
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

export const ReadPreviousPackageVersions = (repo_root: string, before: string) =>
	Effect.gen(function* () {
		const entries = yield* Effect.all(
			release_package_ids.map((package_id) =>
				Effect.gen(function* () {
					const manifest_path = package_manifest_paths[package_id];
					const output = yield* RunCommand(
						"git",
						["show", `${before}:${manifest_path}`],
						repo_root,
					);
					const manifest = yield* DecodeJson(output.stdout, PackageManifestSchema);

					return [package_id, manifest.version] as const;
				}),
			),
		);

		return Object.fromEntries(entries) as PackageVersions;
	});

export const ReadCanonicalReleasePlan = (plan_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const content = yield* file_system.readFileString(plan_path);
		const serialized = yield* DecodeJson(content, SerializedReleasePlanSchema);

		return yield* Effect.try({
			try: () => canonicalize_release_plan(serialized),
			catch: (cause) => cause,
		});
	});

export const ReadArtifactManifest = (manifest_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const content = yield* file_system.readFileString(manifest_path);

		return (yield* DecodeJson(content, ArtifactManifestSchema)) as ArtifactManifest;
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
): ReleasePlan {
	const current_versions = make_package_versions(serialized.version);
	const previous_versions = serialized.previous_version
		? make_package_versions(serialized.previous_version)
		: undefined;
	const plan = plan_release({
		event: serialized.event,
		ref: serialized.ref,
		commit: serialized.commit,
		current_versions,
		...(previous_versions ? { previous_versions } : {}),
		...(serialized.dry_run ? { dry_run: true } : {}),
		...(serialized.intent === "resume"
			? { resume: { version: serialized.version, commit: serialized.commit } }
			: {}),
	});
	const claims_match =
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

function make_package_versions(version: string): PackageVersions {
	return {
		runtime: version,
		grammars: version,
		"language-server": version,
		vsix: version,
	};
}
