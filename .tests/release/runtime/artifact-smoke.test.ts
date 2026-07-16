import {
	ArtifactConsumer,
	SmokeReleaseArtifacts,
	inspect_vsix_artifact,
	make_consumer_package_manifest,
	make_consumer_workspace_config,
	parse_artifact_smoke_request,
	type ConsumerSmokeRequest,
} from "../../../build/release/artifact-smoke.ts";
import {
	create_artifact_manifest,
	type ArtifactInput,
} from "../../../build/release/artifact-manifest.ts";
import { plan_release, type PackageVersions } from "../../../build/release/policy.ts";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { NodeServices } from "@effect/platform-node";
import { strToU8, zipSync } from "fflate";
import { Effect, Layer } from "effect";
import { expect, test } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

const versions: PackageVersions = {
	runtime: "4.1.0",
	grammars: "4.1.0",
	"language-server": "4.1.0",
	vsix: "4.1.0",
};

test("artifact smoke verifies one manifest-bound artifact set through a clean consumer", async () => {
	const fixture = await make_artifact_fixture();
	const consumer_requests: Array<ConsumerSmokeRequest> = [];
	const consumer_layer = Layer.succeed(ArtifactConsumer, {
		verify: (request) => Effect.sync(() => consumer_requests.push(request)),
	});

	try {
		const result = await Effect.runPromise(
			SmokeReleaseArtifacts({
				plan_path: fixture.plan_path,
				manifest_path: fixture.manifest_path,
				artifact_dir: fixture.artifact_dir,
			}).pipe(Effect.provide(consumer_layer), Effect.provide(NodeServices.layer)),
		);

		expect(result.version).toBe("4.1.0");
		expect(result.artifact_names).toEqual(
			fixture.plan.packages.map((pkg) => pkg.artifact_name),
		);
		expect(result.vsix).toEqual({
			name: "svelte-effect-runtime-vscode",
			version: "4.1.0",
			main: "./.dist/extension.cjs",
			extension_byte_size: 23,
		});
		expect(consumer_requests).toEqual([
			{
				version: "4.1.0",
				artifact_paths: fixture.plan.packages
					.filter((pkg) => pkg.artifact_kind === "npm-tarball")
					.map((pkg) => join(fixture.artifact_dir, pkg.artifact_name)),
			},
		]);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("artifact smoke rejects stale package artifacts before consumer installation", async () => {
	const fixture = await make_artifact_fixture();
	const consumer_layer = Layer.succeed(ArtifactConsumer, {
		verify: () => Effect.die("consumer must not run"),
	});

	try {
		await writeFile(join(fixture.artifact_dir, "stale-3.9.0.tgz"), "stale");

		await expect(
			Effect.runPromise(
				SmokeReleaseArtifacts({
					plan_path: fixture.plan_path,
					manifest_path: fixture.manifest_path,
					artifact_dir: fixture.artifact_dir,
				}).pipe(Effect.provide(consumer_layer), Effect.provide(NodeServices.layer)),
			),
		).rejects.toThrow(/must contain exactly/i);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("VSIX inspection rejects extension identity drift", () => {
	const bytes = make_vsix_bytes({ version: "4.0.0" });

	expect(() => inspect_vsix_artifact(bytes, "4.1.0")).toThrow(/expected 4\.1\.0/i);
});

test("artifact smoke CLI and consumer manifest accept only exact inputs", () => {
	expect(
		parse_artifact_smoke_request([
			"--plan",
			"plan.json",
			"--manifest",
			"manifest.json",
			"--artifact-dir",
			"artifacts",
		]),
	).toEqual({
		plan_path: "plan.json",
		manifest_path: "manifest.json",
		artifact_dir: "artifacts",
	});
	expect(() => parse_artifact_smoke_request(["--plan", "plan.json"])).toThrow(
		/--plan, --manifest, and --artifact-dir/i,
	);
	expect(
		make_consumer_package_manifest({
			version: "4.0.1",
			artifact_paths: [
				"/artifacts/svelte-effect-runtime-4.0.1.tgz",
				"/artifacts/svelte-effect-runtime-grammars-4.0.1.tgz",
				"/artifacts/svelte-effect-runtime-language-server-4.0.1.tgz",
			],
		}),
	).toMatchObject({
		dependencies: {
			"svelte-effect-runtime": "file:/artifacts/svelte-effect-runtime-4.0.1.tgz",
			"svelte-effect-runtime-grammars":
				"file:/artifacts/svelte-effect-runtime-grammars-4.0.1.tgz",
			"svelte-effect-runtime-language-server":
				"file:/artifacts/svelte-effect-runtime-language-server-4.0.1.tgz",
		},
	});
	expect(
		make_consumer_workspace_config({
			version: "4.0.1",
			artifact_paths: [
				"/artifacts/svelte-effect-runtime-4.0.1.tgz",
				"/artifacts/svelte-effect-runtime-grammars-4.0.1.tgz",
				"/artifacts/svelte-effect-runtime-language-server-4.0.1.tgz",
			],
		}),
	).toContain(
		'"svelte-effect-runtime-grammars@4.0.1": "file:/artifacts/svelte-effect-runtime-grammars-4.0.1.tgz"',
	);
	expect(() => make_consumer_package_manifest({ version: "4.0.1", artifact_paths: [] })).toThrow(
		/exactly three npm tarballs/i,
	);
});

async function make_artifact_fixture() {
	const root = await mkdtemp(join(tmpdir(), "ser-artifact-smoke-"));
	const artifact_dir = join(root, "artifacts");
	const plan_path = join(root, "plan.json");
	const manifest_path = join(root, "manifest.json");
	const plan = plan_release({
		event: "pull_request",
		ref: "refs/pull/29/merge",
		commit: "abcdef0123456789abcdef0123456789abcdef01",
		current_versions: versions,
	});
	const files: Array<ArtifactInput> = plan.packages.map((pkg) => ({
		name: pkg.artifact_name,
		bytes:
			pkg.artifact_kind === "vsix"
				? make_vsix_bytes({ version: plan.version })
				: strToU8(`${pkg.id} artifact`),
	}));
	const manifest = create_artifact_manifest(plan, files);

	await mkdir(artifact_dir);
	await Promise.all([
		writeFile(plan_path, `${JSON.stringify(plan)}\n`),
		writeFile(manifest_path, `${JSON.stringify(manifest)}\n`),
		...files.map((file) => writeFile(join(artifact_dir, file.name), file.bytes)),
	]);

	return { root, artifact_dir, plan_path, manifest_path, plan };
}

function make_vsix_bytes(options: { version: string }): Uint8Array {
	return zipSync({
		"extension/package.json": strToU8(
			JSON.stringify({
				name: "svelte-effect-runtime-vscode",
				version: options.version,
				main: "./.dist/extension.cjs",
			}),
		),
		"extension/.dist/extension.cjs": strToU8("module.exports = true;\n"),
	});
}
