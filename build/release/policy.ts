import { compare_semantic_versions, is_semantic_version } from "./semantic-version.ts";
import { Schema } from "effect";

export const release_channels = Object.freeze(["npm", "openvsx", "github-release"] as const);
export const ReleaseChannelSchema = Schema.Literals(release_channels);

export type ReleaseChannel = typeof ReleaseChannelSchema.Type;

export const release_package_ids = Object.freeze([
	"runtime",
	"grammars",
	"language-server",
	"vsix",
] as const);

export type ReleasePackageId = (typeof release_package_ids)[number];
export type ArtifactKind = "npm-tarball" | "vsix";
export type PackageVersions = Record<ReleasePackageId, string>;

export type ReleasePackageDefinition = {
	id: ReleasePackageId;
	package_name: string;
	artifact_kind: ArtifactKind;
	build_dependencies: ReadonlyArray<ReleasePackageId>;
	publish_dependencies: ReadonlyArray<ReleasePackageId>;
	channels: ReadonlyArray<ReleaseChannel>;
};

export type PlannedReleasePackage = ReleasePackageDefinition & {
	artifact_name: string;
};

const mutable_release_package_definitions = [
	{
		id: "runtime",
		package_name: "svelte-effect-runtime",
		artifact_kind: "npm-tarball",
		build_dependencies: [],
		publish_dependencies: [],
		channels: ["npm", "github-release"],
	},
	{
		id: "grammars",
		package_name: "svelte-effect-runtime-grammars",
		artifact_kind: "npm-tarball",
		build_dependencies: [],
		publish_dependencies: [],
		channels: ["npm", "github-release"],
	},
	{
		id: "language-server",
		package_name: "svelte-effect-runtime-language-server",
		artifact_kind: "npm-tarball",
		build_dependencies: ["runtime"],
		publish_dependencies: ["grammars"],
		channels: ["npm", "github-release"],
	},
	{
		id: "vsix",
		package_name: "svelte-effect-runtime-vscode",
		artifact_kind: "vsix",
		build_dependencies: [],
		publish_dependencies: ["language-server"],
		channels: ["openvsx", "github-release"],
	},
] as const satisfies ReadonlyArray<ReleasePackageDefinition>;

export const release_package_definitions: ReadonlyArray<ReleasePackageDefinition> = Object.freeze(
	mutable_release_package_definitions.map((definition) =>
		Object.freeze({
			...definition,
			build_dependencies: Object.freeze([...definition.build_dependencies]),
			publish_dependencies: Object.freeze([...definition.publish_dependencies]),
			channels: Object.freeze([...definition.channels]),
		}),
	),
);

export type ReleaseEvent = "pull_request" | "push" | "workflow_dispatch";
export type ReleaseMode = "dry-run" | "release" | "resume";

export type ReleaseRepositoryState = {
	candidate_head: string;
	candidate_is_on_master: boolean;
	greatest_release_version: string | undefined;
	current_tag_exists: boolean;
};

export type PlanReleaseInput = {
	event: ReleaseEvent;
	ref: string;
	commit: string;
	execution_commit?: string;
	current_versions: PackageVersions;
	mode?: ReleaseMode;
	repository_state?: ReleaseRepositoryState;
	resume?: {
		version: string;
		commit: string;
	};
};

type ReleasePlanBase = {
	readonly event: ReleaseEvent;
	readonly ref: string;
	readonly commit: string;
	readonly version: string;
	readonly tag: string;
	readonly channels: ReadonlyArray<ReleaseChannel>;
	readonly packages: ReadonlyArray<PlannedReleasePackage>;
};

export type ReleasePlan = ReleasePlanBase &
	(
		| {
				readonly _tag: "Verify";
				readonly mode: undefined;
				readonly previous_version: undefined;
				readonly intent: "verify";
				readonly publish: false;
				readonly dry_run: false;
				readonly version_changed: false;
		  }
		| {
				readonly _tag: "DryRun";
				readonly mode: "dry-run";
				readonly previous_version: string | undefined;
				readonly intent: "verify";
				readonly publish: false;
				readonly dry_run: true;
				readonly version_changed: true;
		  }
		| {
				readonly _tag: "Publish";
				readonly mode: "release";
				readonly previous_version: string | undefined;
				readonly intent: "publish";
				readonly publish: true;
				readonly dry_run: false;
				readonly version_changed: true;
		  }
		| {
				readonly _tag: "Resume";
				readonly mode: "resume";
				readonly previous_version: string | undefined;
				readonly intent: "resume";
				readonly publish: true;
				readonly dry_run: false;
				readonly version_changed: boolean;
		  }
	);

export const candidate_release_ref = "refs/heads/candidate";

export function parse_release_channel(input: unknown): ReleaseChannel {
	return Schema.decodeUnknownSync(ReleaseChannelSchema)(input);
}

export function expected_artifact_name(
	definition: ReleasePackageDefinition,
	version: string,
): string {
	const extension = definition.artifact_kind === "vsix" ? "vsix" : "tgz";

	return `${definition.package_name}-${version}.${extension}`;
}

export function plan_release(input: PlanReleaseInput): ReleasePlan {
	const version = resolve_synchronized_version("current", input.current_versions);
	const packages = Object.freeze(
		release_package_definitions.map((definition) =>
			Object.freeze({
				...definition,
				artifact_name: expected_artifact_name(definition, version),
			}),
		),
	);

	if (input.event !== "workflow_dispatch") {
		if (input.mode || input.repository_state || input.resume) {
			throw new Error("Only workflow_dispatch may specify release mode or repository state.");
		}

		return make_plan(input, {
			_tag: "Verify",
			version,
			previous_version: undefined,
			version_changed: false,
			packages,
			intent: "verify",
			publish: false,
			dry_run: false,
		});
	}

	const mode = input.mode;
	const repository_state = input.repository_state;

	if (!mode) {
		throw new Error("A candidate workflow dispatch requires an explicit release mode.");
	}

	if (input.ref !== candidate_release_ref) {
		throw new Error(
			`A release workflow dispatch is only allowed from ${candidate_release_ref}.`,
		);
	}

	if (!repository_state) {
		throw new Error("A candidate workflow dispatch requires verified repository state.");
	}

	const execution_commit = input.execution_commit ?? input.commit;

	if (repository_state.candidate_head !== execution_commit) {
		throw new Error(
			`Execution commit ${execution_commit} does not match candidate head ${repository_state.candidate_head}.`,
		);
	}

	if (!repository_state.candidate_is_on_master) {
		throw new Error(`Candidate commit ${input.commit} must be reachable from master.`);
	}

	if (mode !== "resume" && input.resume) {
		throw new Error("Resume values require resume mode.");
	}

	const previous_version = repository_state.greatest_release_version;
	const version_changed = previous_version
		? compare_semantic_versions(version, previous_version) > 0
		: true;

	if (mode !== "resume") {
		if (repository_state.current_tag_exists) {
			throw new Error(`Release tag v${version} already exists; use resume mode.`);
		}

		if (!version_changed) {
			throw new Error(
				`Release version ${version} must be greater than greatest release version ${previous_version}.`,
			);
		}

		if (mode === "release") {
			return make_plan(input, {
				_tag: "Publish",
				version,
				previous_version,
				version_changed: true,
				packages,
				intent: "publish",
				publish: true,
				dry_run: false,
			});
		}

		return make_plan(input, {
			_tag: "DryRun",
			version,
			previous_version,
			version_changed: true,
			packages,
			intent: "verify",
			publish: false,
			dry_run: true,
		});
	}

	const resume = input.resume;

	if (!resume) {
		throw new Error("Resume requires an exact version and commit.");
	}

	if (resume.version !== version) {
		throw new Error(
			`Resume version ${resume.version} does not match current version ${version}.`,
		);
	}

	if (resume.commit !== input.commit) {
		throw new Error(
			`Resume commit ${resume.commit} does not match checked out commit ${input.commit}.`,
		);
	}

	if (previous_version && compare_semantic_versions(version, previous_version) < 0) {
		throw new Error(
			`Resume version ${version} cannot precede greatest release version ${previous_version}.`,
		);
	}

	return make_plan(input, {
		_tag: "Resume",
		version,
		previous_version,
		version_changed,
		packages,
		intent: "resume",
		publish: true,
		dry_run: false,
	});
}

export function validate_resume_source_plan(
	resume_plan: ReleasePlan,
	source_plan: ReleasePlan,
): ReleasePlan {
	if (resume_plan.mode !== "resume" || !resume_plan.publish) {
		throw new Error("The current release plan must be a publishing resume.");
	}

	if (
		(source_plan.mode !== "release" && source_plan.mode !== "resume") ||
		!source_plan.publish ||
		source_plan.dry_run
	) {
		throw new Error("Resume artifacts must come from a prior publishing release plan.");
	}

	const current_identity = release_plan_identity(resume_plan);
	const source_identity = release_plan_identity(source_plan);

	if (current_identity !== source_identity) {
		throw new Error("Resume source does not match the current version, commit, or artifacts.");
	}

	return source_plan;
}

function resolve_synchronized_version(label: "current" | "previous", versions: PackageVersions) {
	const entries = release_package_ids.map((id) => [id, versions[id]] as const);
	const invalid_entry = entries.find(([, version]) => !is_semantic_version(version));

	if (invalid_entry) {
		throw new Error(
			`Invalid semantic version for ${label} package ${invalid_entry[0]}: ${invalid_entry[1]}.`,
		);
	}

	const unique_versions = new Set(entries.map(([, version]) => version));

	if (unique_versions.size !== 1) {
		const detail = entries.map(([id, version]) => `${id}=${version}`).join(", ");

		throw new Error(`${capitalize(label)} package versions are not synchronized: ${detail}.`);
	}

	return entries[0][1];
}

function make_plan(
	input: PlanReleaseInput,
	policy:
		| {
				readonly _tag: "Verify";
				readonly version: string;
				readonly previous_version: undefined;
				readonly version_changed: false;
				readonly packages: ReadonlyArray<PlannedReleasePackage>;
				readonly intent: "verify";
				readonly publish: false;
				readonly dry_run: false;
		  }
		| {
				readonly _tag: "DryRun";
				readonly version: string;
				readonly previous_version: string | undefined;
				readonly version_changed: true;
				readonly packages: ReadonlyArray<PlannedReleasePackage>;
				readonly intent: "verify";
				readonly publish: false;
				readonly dry_run: true;
		  }
		| {
				readonly _tag: "Publish";
				readonly version: string;
				readonly previous_version: string | undefined;
				readonly version_changed: true;
				readonly packages: ReadonlyArray<PlannedReleasePackage>;
				readonly intent: "publish";
				readonly publish: true;
				readonly dry_run: false;
		  }
		| {
				readonly _tag: "Resume";
				readonly version: string;
				readonly previous_version: string | undefined;
				readonly version_changed: boolean;
				readonly packages: ReadonlyArray<PlannedReleasePackage>;
				readonly intent: "resume";
				readonly publish: true;
				readonly dry_run: false;
		  },
): ReleasePlan {
	const base = {
		event: input.event,
		ref: input.ref,
		commit: input.commit,
		version: policy.version,
		tag: `v${policy.version}`,
		channels: Object.freeze([...release_channels]),
		packages: policy.packages,
	};
	if (policy._tag === "Verify") {
		return Object.freeze({ ...base, ...policy, mode: undefined });
	}

	if (policy._tag === "DryRun") {
		return Object.freeze({ ...base, ...policy, mode: "dry-run" });
	}

	if (policy._tag === "Publish") {
		return Object.freeze({ ...base, ...policy, mode: "release" });
	}

	return Object.freeze({ ...base, ...policy, mode: "resume" });
}

function release_plan_identity(plan: ReleasePlan): string {
	return JSON.stringify({
		commit: plan.commit,
		version: plan.version,
		tag: plan.tag,
		channels: plan.channels,
		packages: plan.packages.map((pkg) => ({
			id: pkg.id,
			artifact_name: pkg.artifact_name,
			build_dependencies: pkg.build_dependencies,
			publish_dependencies: pkg.publish_dependencies,
			channels: pkg.channels,
		})),
	});
}

function capitalize(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
