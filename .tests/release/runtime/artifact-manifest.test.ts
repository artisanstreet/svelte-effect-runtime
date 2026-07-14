import {
	create_artifact_manifest,
	validate_artifact_manifest,
	type ArtifactInput,
} from "../../../build/release/artifact-manifest.ts";
import { plan_release, type PackageVersions } from "../../../build/release/policy.ts";
import { expect, test } from "vitest";

const current_versions: PackageVersions = {
	runtime: "4.1.0",
	grammars: "4.1.0",
	"language-server": "4.1.0",
	vsix: "4.1.0",
};

const previous_versions: PackageVersions = {
	runtime: "4.0.0",
	grammars: "4.0.0",
	"language-server": "4.0.0",
	vsix: "4.0.0",
};

const encoder = new TextEncoder();
const files: ReadonlyArray<ArtifactInput> = [
	{
		name: "svelte-effect-runtime-4.1.0.tgz",
		bytes: encoder.encode("runtime artifact"),
	},
	{
		name: "svelte-effect-runtime-grammars-4.1.0.tgz",
		bytes: encoder.encode("grammars artifact"),
	},
	{
		name: "svelte-effect-runtime-language-server-4.1.0.tgz",
		bytes: encoder.encode("language server artifact"),
	},
	{
		name: "svelte-effect-runtime-vscode-4.1.0.vsix",
		bytes: encoder.encode("extension artifact"),
	},
];

const plan = plan_release({
	event: "push",
	ref: "refs/heads/master",
	commit: "release-commit",
	current_versions,
	previous_versions,
});

test("manifest creation binds canonical artifact identities and bytes to the release plan", () => {
	const manifest = create_artifact_manifest(plan, files.toReversed());

	expect(manifest).toMatchObject({
		schema_version: 1,
		commit: "release-commit",
		version: "4.1.0",
		tag: "v4.1.0",
		channels: ["npm", "openvsx", "github-release"],
	});
	expect(manifest.artifacts.map((artifact) => artifact.name)).toEqual(
		plan.packages.map((pkg) => pkg.artifact_name),
	);
	expect(manifest.artifacts[0]).toEqual({
		name: "svelte-effect-runtime-4.1.0.tgz",
		package_id: "runtime",
		package_name: "svelte-effect-runtime",
		kind: "npm-tarball",
		byte_size: 16,
		sha256: "5c92404b2db3d9047a6ce860ea6f29af2977cd94501fd27273cb4fe72828271d",
		sha512_sri:
			"sha512-UsvhFDlKFdvG5iBIim51IqRrst/stYJ8hQ5V/aP0Bmz9fv7MVgX9g4vC1Ky4x0M+8g7j7dJkJXW91WnrPcRToA==",
	});
	expect(Object.isFrozen(manifest)).toBe(true);
	expect(Object.isFrozen(manifest.channels)).toBe(true);
	expect(Object.isFrozen(manifest.artifacts)).toBe(true);
	expect(manifest.artifacts.every(Object.isFrozen)).toBe(true);
});

test("manifest creation accepts exactly one file for every planned artifact", () => {
	expect(() => create_artifact_manifest(plan, files.slice(1))).toThrow(
		/missing planned artifact svelte-effect-runtime-4\.1\.0\.tgz/i,
	);
	expect(() => create_artifact_manifest(plan, [files[0], ...files])).toThrow(
		/duplicate artifact svelte-effect-runtime-4\.1\.0\.tgz/i,
	);
	expect(() =>
		create_artifact_manifest(plan, [
			{ ...files[0], name: "svelte-effect-runtime-4.0.0.tgz" },
			...files.slice(1),
		]),
	).toThrow(/unexpected artifact svelte-effect-runtime-4\.0\.0\.tgz/i);
	expect(() =>
		create_artifact_manifest(plan, [
			...files,
			{ name: "extra.tgz", bytes: encoder.encode("extra") },
		]),
	).toThrow(/unexpected artifact extra\.tgz/i);
});

test("manifest validation rejects external data bound to another release", () => {
	const manifest = create_artifact_manifest(plan, files);

	expect(() =>
		validate_artifact_manifest(plan, { ...manifest, commit: "different-commit" }, files),
	).toThrow(/manifest commit different-commit does not match plan commit release-commit/i);
	expect(() =>
		validate_artifact_manifest(plan, { ...manifest, version: "4.0.0" }, files),
	).toThrow(/manifest version 4\.0\.0 does not match plan version 4\.1\.0/i);
	expect(() => validate_artifact_manifest(plan, { ...manifest, tag: "v4.0.0" }, files)).toThrow(
		/manifest tag v4\.0\.0 does not match plan tag v4\.1\.0/i,
	);
	expect(() =>
		validate_artifact_manifest(
			plan,
			{ ...manifest, channels: ["npm", "github-release", "openvsx"] },
			files,
		),
	).toThrow(/manifest channels do not match the release plan/i);
	expect(() =>
		validate_artifact_manifest(
			plan,
			{
				...manifest,
				artifacts: [
					{ ...manifest.artifacts[0], sha256: "invalid" },
					...manifest.artifacts.slice(1),
				],
			},
			files,
		),
	).toThrow();
});

test("manifest validation rejects reordered or changed artifact identities", () => {
	const manifest = create_artifact_manifest(plan, files);
	const reordered = {
		...manifest,
		artifacts: [manifest.artifacts[1], manifest.artifacts[0], ...manifest.artifacts.slice(2)],
	};
	const renamed_package = {
		...manifest,
		artifacts: [
			{ ...manifest.artifacts[0], package_name: "different-package" },
			...manifest.artifacts.slice(1),
		],
	};

	expect(() => validate_artifact_manifest(plan, reordered, files)).toThrow(
		/artifact identity drift at position 1/i,
	);
	expect(() => validate_artifact_manifest(plan, renamed_package, files)).toThrow(
		/artifact identity drift at position 1/i,
	);
});

test("manifest validation rejects size or hash drift from the bytes being promoted", () => {
	const manifest = create_artifact_manifest(plan, files);
	const wrong_size = {
		...manifest,
		artifacts: [
			{ ...manifest.artifacts[0], byte_size: manifest.artifacts[0].byte_size + 1 },
			...manifest.artifacts.slice(1),
		],
	};
	const wrong_hash = {
		...manifest,
		artifacts: [
			{ ...manifest.artifacts[0], sha256: "0".repeat(64) },
			...manifest.artifacts.slice(1),
		],
	};
	const changed_files = [
		{ ...files[0], bytes: encoder.encode("changed runtime artifact") },
		...files.slice(1),
	];

	expect(() => validate_artifact_manifest(plan, wrong_size, files)).toThrow(
		/byte size does not match supplied bytes/i,
	);
	expect(() => validate_artifact_manifest(plan, wrong_hash, files)).toThrow(
		/sha256 does not match supplied bytes/i,
	);
	expect(() => validate_artifact_manifest(plan, manifest, changed_files)).toThrow(
		/byte size does not match supplied bytes/i,
	);
});
