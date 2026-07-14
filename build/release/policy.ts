import { compare_semantic_versions, validate_semantic_version } from "./semantic-version.ts";
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
export type ReleaseIntent = "verify" | "publish" | "resume";

export type PlanReleaseInput = {
	event: ReleaseEvent;
	ref: string;
	commit: string;
	current_versions: PackageVersions;
	previous_versions?: PackageVersions;
	dry_run?: boolean;
	resume?: {
		version: string;
		commit: string;
	};
};

export type ReleasePlan = {
	event: ReleaseEvent;
	ref: string;
	commit: string;
	version: string;
	previous_version: string | undefined;
	tag: string;
	intent: ReleaseIntent;
	publish: boolean;
	dry_run: boolean;
	version_changed: boolean;
	channels: ReadonlyArray<ReleaseChannel>;
	packages: ReadonlyArray<PlannedReleasePackage>;
};

const protected_release_ref = "refs/heads/master";

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
	const previous_version = input.previous_versions
		? resolve_synchronized_version("previous", input.previous_versions)
		: undefined;
	const versions_differ = previous_version !== undefined && previous_version !== version;
	const version_changed = versions_differ
		? compare_semantic_versions(version, previous_version) > 0
		: false;
	const packages = Object.freeze(
		release_package_definitions.map((definition) =>
			Object.freeze({
				...definition,
				artifact_name: expected_artifact_name(definition, version),
			}),
		),
	);

	if (versions_differ && !version_changed) {
		throw new Error(
			`Release version ${version} must be greater than previous version ${previous_version}.`,
		);
	}

	/**
	 * A manual run is non-mutating unless it explicitly resumes the exact current version.
	 */
	if (input.event === "workflow_dispatch") {
		const resume = input.resume;

		if (!resume) {
			return make_plan(input, {
				version,
				previous_version,
				version_changed,
				packages,
				intent: "verify",
				publish: false,
				dry_run: true,
			});
		}

		if (input.ref !== protected_release_ref) {
			throw new Error(`Resume is only allowed from ${protected_release_ref}.`);
		}

		if (input.dry_run === true) {
			throw new Error("A release resume cannot also be a dry run.");
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

		return make_plan(input, {
			version,
			previous_version,
			version_changed,
			packages,
			intent: "resume",
			publish: true,
			dry_run: false,
		});
	}

	/**
	 * Protected-branch pushes publish only a synchronized version change.
	 */
	if (input.event === "push" && input.ref === protected_release_ref) {
		if (previous_version === undefined) {
			throw new Error("A protected-branch push requires previous package versions.");
		}

		if (version_changed) {
			return make_plan(input, {
				version,
				previous_version,
				version_changed,
				packages,
				intent: "publish",
				publish: true,
				dry_run: false,
			});
		}
	}

	return make_plan(input, {
		version,
		previous_version,
		version_changed,
		packages,
		intent: "verify",
		publish: false,
		dry_run: input.dry_run ?? false,
	});
}

function resolve_synchronized_version(label: "current" | "previous", versions: PackageVersions) {
	const entries = release_package_ids.map((id) => [id, versions[id]] as const);
	const invalid_entry = entries.find(([, version]) => {
		try {
			validate_semantic_version(version);

			return false;
		} catch {
			return true;
		}
	});

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
	policy: {
		version: string;
		previous_version: string | undefined;
		version_changed: boolean;
		packages: ReadonlyArray<PlannedReleasePackage>;
		intent: ReleaseIntent;
		publish: boolean;
		dry_run: boolean;
	},
): ReleasePlan {
	const plan: ReleasePlan = {
		event: input.event,
		ref: input.ref,
		commit: input.commit,
		version: policy.version,
		previous_version: policy.previous_version,
		tag: `v${policy.version}`,
		intent: policy.intent,
		publish: policy.publish,
		dry_run: policy.dry_run,
		version_changed: policy.version_changed,
		channels: Object.freeze([...release_channels]),
		packages: policy.packages,
	};

	return Object.freeze(plan);
}

function capitalize(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
