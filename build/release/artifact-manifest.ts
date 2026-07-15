import {
	release_package_ids,
	ReleaseChannelSchema,
	type ArtifactKind,
	type ReleaseChannel,
	type ReleasePackageId,
	type ReleasePlan,
} from "./policy.ts";
import { createHash } from "node:crypto";
import { Schema } from "effect";

export type ArtifactInput = {
	name: string;
	bytes: Uint8Array;
};

export type ArtifactManifestEntry = {
	readonly name: string;
	readonly package_id: ReleasePackageId;
	readonly package_name: string;
	readonly kind: ArtifactKind;
	readonly byte_size: number;
	readonly sha256: string;
	readonly sha512_sri: string;
};

export type ArtifactManifest = {
	readonly schema_version: 1;
	readonly commit: string;
	readonly version: string;
	readonly tag: string;
	readonly channels: ReadonlyArray<ReleaseChannel>;
	readonly artifacts: ReadonlyArray<ArtifactManifestEntry>;
};

const ArtifactKindSchema = Schema.Literals(["npm-tarball", "vsix"] as const);
const ReleasePackageIdSchema = Schema.Literals(release_package_ids);
const Sha256Schema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));
const Sha512SriSchema = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^sha512-[A-Za-z0-9+/]+={0,2}$/)),
);
const ArtifactManifestEntrySchema = Schema.Struct({
	name: Schema.String,
	package_id: ReleasePackageIdSchema,
	package_name: Schema.String,
	kind: ArtifactKindSchema,
	byte_size: Schema.Number,
	sha256: Sha256Schema,
	sha512_sri: Sha512SriSchema,
});

export const ArtifactManifestSchema = Schema.Struct({
	schema_version: Schema.Literals([1] as const),
	commit: Schema.String,
	version: Schema.String,
	tag: Schema.String,
	channels: Schema.Array(ReleaseChannelSchema),
	artifacts: Schema.Array(ArtifactManifestEntrySchema),
});

export function create_artifact_manifest(
	plan: ReleasePlan,
	files: ReadonlyArray<ArtifactInput>,
): ArtifactManifest {
	const files_by_name = validate_artifact_inputs(plan, files);
	const artifacts = plan.packages.map((pkg) => {
		const file = files_by_name.get(pkg.artifact_name);

		if (!file) {
			throw new Error(`Missing planned artifact ${pkg.artifact_name}.`);
		}

		return make_manifest_entry(pkg, file);
	});
	const manifest: ArtifactManifest = {
		schema_version: 1,
		commit: plan.commit,
		version: plan.version,
		tag: plan.tag,
		channels: plan.channels,
		artifacts,
	};

	return freeze_manifest(manifest);
}

export function validate_artifact_manifest(
	plan: ReleasePlan,
	external_manifest: unknown,
	files: ReadonlyArray<ArtifactInput>,
): ArtifactManifest {
	const decoded = Schema.decodeUnknownSync(ArtifactManifestSchema)(external_manifest);
	const manifest = decoded as ArtifactManifest;
	const expected_manifest = create_artifact_manifest(plan, files);

	validate_plan_binding(plan, manifest);
	validate_artifact_identities(plan, manifest);

	for (const [index, artifact] of manifest.artifacts.entries()) {
		const expected = expected_manifest.artifacts[index];

		if (artifact.byte_size !== expected.byte_size) {
			throw new Error(`${artifact.name} byte size does not match supplied bytes.`);
		}

		if (artifact.sha256 !== expected.sha256) {
			throw new Error(`${artifact.name} sha256 does not match supplied bytes.`);
		}

		if (artifact.sha512_sri !== expected.sha512_sri) {
			throw new Error(`${artifact.name} sha512 SRI does not match supplied bytes.`);
		}
	}

	return freeze_manifest(manifest);
}

function validate_artifact_inputs(
	plan: ReleasePlan,
	files: ReadonlyArray<ArtifactInput>,
): ReadonlyMap<string, ArtifactInput> {
	const expected_names = new Set(plan.packages.map((pkg) => pkg.artifact_name));
	const files_by_name = new Map<string, ArtifactInput>();

	for (const file of files) {
		if (files_by_name.has(file.name)) {
			throw new Error(`Duplicate artifact ${file.name}.`);
		}

		files_by_name.set(file.name, file);
	}

	const unexpected_name = [...files_by_name.keys()].find((name) => !expected_names.has(name));

	if (unexpected_name) {
		throw new Error(`Unexpected artifact ${unexpected_name}.`);
	}

	const missing_name = [...expected_names].find((name) => !files_by_name.has(name));

	if (missing_name) {
		throw new Error(`Missing planned artifact ${missing_name}.`);
	}

	return files_by_name;
}

function validate_plan_binding(plan: ReleasePlan, manifest: ArtifactManifest): void {
	if (manifest.commit !== plan.commit) {
		throw new Error(
			`Manifest commit ${manifest.commit} does not match plan commit ${plan.commit}.`,
		);
	}

	if (manifest.version !== plan.version) {
		throw new Error(
			`Manifest version ${manifest.version} does not match plan version ${plan.version}.`,
		);
	}

	if (manifest.tag !== plan.tag) {
		throw new Error(`Manifest tag ${manifest.tag} does not match plan tag ${plan.tag}.`);
	}

	if (!arrays_equal(manifest.channels, plan.channels)) {
		throw new Error("Manifest channels do not match the release plan.");
	}
}

function validate_artifact_identities(plan: ReleasePlan, manifest: ArtifactManifest): void {
	const names = manifest.artifacts.map((artifact) => artifact.name);
	const duplicate_name = names.find((name, index) => names.indexOf(name) !== index);
	const expected_names = new Set(plan.packages.map((pkg) => pkg.artifact_name));
	const unexpected_name = names.find((name) => !expected_names.has(name));
	const missing_name = [...expected_names].find((name) => !names.includes(name));

	if (duplicate_name) {
		throw new Error(`Duplicate artifact ${duplicate_name} in manifest.`);
	}

	if (unexpected_name) {
		throw new Error(`Unexpected artifact ${unexpected_name} in manifest.`);
	}

	if (missing_name) {
		throw new Error(`Missing planned artifact ${missing_name} from manifest.`);
	}

	if (manifest.artifacts.length !== plan.packages.length) {
		throw new Error("Manifest artifact count does not match the release plan.");
	}

	for (const [index, artifact] of manifest.artifacts.entries()) {
		const expected = plan.packages[index];
		const identity_matches =
			artifact.name === expected.artifact_name &&
			artifact.package_id === expected.id &&
			artifact.package_name === expected.package_name &&
			artifact.kind === expected.artifact_kind;

		if (!identity_matches) {
			throw new Error(`Artifact identity drift at position ${index + 1}.`);
		}

		if (!Number.isSafeInteger(artifact.byte_size) || artifact.byte_size < 0) {
			throw new Error(`${artifact.name} has an invalid byte size.`);
		}
	}
}

function make_manifest_entry(
	pkg: ReleasePlan["packages"][number],
	file: ArtifactInput,
): ArtifactManifestEntry {
	return {
		name: file.name,
		package_id: pkg.id,
		package_name: pkg.package_name,
		kind: pkg.artifact_kind,
		byte_size: file.bytes.byteLength,
		sha256: createHash("sha256").update(file.bytes).digest("hex"),
		sha512_sri: `sha512-${createHash("sha512").update(file.bytes).digest("base64")}`,
	};
}

function freeze_manifest(manifest: ArtifactManifest): ArtifactManifest {
	const channels = Object.freeze([...manifest.channels]);
	const artifacts = Object.freeze(
		manifest.artifacts.map((artifact) => Object.freeze({ ...artifact })),
	);

	return Object.freeze({ ...manifest, channels, artifacts });
}

function arrays_equal<A>(left: ReadonlyArray<A>, right: ReadonlyArray<A>): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
