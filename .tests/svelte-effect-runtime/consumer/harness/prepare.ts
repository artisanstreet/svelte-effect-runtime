import { createHash } from "node:crypto";
import { CommandName, RepoRoot, RemovePath, RunCommand } from "../../../../build/node-utils.ts";
import { get_target, make_targets } from "../../unit/harness/target.ts";
import type { HarnessPhase, Target, TargetName, TargetSource } from "../../unit/harness/model.ts";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";

type ResolvedArtifact = {
	readonly path: string;
	readonly sha256: string;
	readonly source: string;
	readonly version: string;
	readonly commit?: string;
};

const PackageManifestSchema = Schema.Struct({
	version: Schema.String,
});

const default_sveltekit_version = "3.0.0-next.6";
const adapter_patch_name = "@sveltejs__adapter-node@6.0.0-next.3.patch";

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const corepack = yield* CommandName("corepack");
	const stable_source = process.env.SER_STABLE_TARGET ?? "package:svelte-effect-runtime@4.0.0";
	const candidate_source =
		process.env.SER_CANDIDATE_TARGET ??
		"artifact:.dist/svelte-effect-runtime/svelte-effect-runtime-4.0.0.tgz";
	const sveltekit_version = process.env.SVELTEKIT_VERSION ?? default_sveltekit_version;
	const targets = make_targets(stable_source, candidate_source);
	const conformance_root = path.join(repo_root, ".dist", "conformance");
	const applications_root = path.join(conformance_root, "applications");
	const artifacts_root = path.join(conformance_root, "artifacts");
	const evidence_root = path.join(conformance_root, "evidence", "prepare", sveltekit_version);

	yield* EnsureContained(repo_root, conformance_root);
	yield* RemovePath(conformance_root);
	yield* file_system.makeDirectory(conformance_root, { recursive: true });

	const candidate = get_target(targets, "candidate");

	if (candidate.source._tag === "Artifact" && is_default_candidate(candidate.source.path)) {
		yield* RunPhase(
			corepack,
			["pnpm", "run", "build:runtime"],
			repo_root,
			evidence_root,
			"candidate",
			"artifact-build",
		);
		yield* RunPhase(
			"vp",
			["node", "build/pack.ts", "svelte-effect-runtime"],
			repo_root,
			evidence_root,
			"candidate",
			"artifact-pack",
		);
	}

	const artifacts = new Map<TargetName, ResolvedArtifact>();

	for (const target of targets) {
		if (target.source._tag === "Native") {
			continue;
		}

		const artifact = yield* ResolveArtifact(
			target,
			repo_root,
			artifacts_root,
			evidence_root,
			corepack,
		);

		artifacts.set(target.name, artifact);
	}

	for (const target of targets) {
		const artifact = artifacts.get(target.name);

		yield* PrepareApplication(
			target,
			artifact,
			repo_root,
			applications_root,
			evidence_root,
			sveltekit_version,
			corepack,
		);
	}

	const metadata = {
		sveltekit_version,
		targets: targets.map((target) => ({
			name: target.name,
			fixture: target.fixture,
			source: target.source,
			artifact: artifacts.get(target.name),
			application: path.join(applications_root, target.name).replaceAll("\\", "/"),
		})),
	};

	yield* file_system.writeFileString(
		path.join(conformance_root, "targets.json"),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);
	yield* Console.log(
		`Prepared native, stable, and candidate conformance applications for SvelteKit ${sveltekit_version}.`,
	);
});

const ResolveArtifact = (
	target: Target,
	repo_root: string,
	artifacts_root: string,
	evidence_root: string,
	corepack: string,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const target_dir = path.join(artifacts_root, target.name);
		const artifact_path = path.join(target_dir, "svelte-effect-runtime.tgz");

		yield* file_system.makeDirectory(target_dir, { recursive: true });

		const resolved = yield* ResolveArtifactSource(
			target,
			repo_root,
			target_dir,
			artifact_path,
			evidence_root,
			corepack,
		);
		const bytes = yield* file_system.readFile(artifact_path);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const artifact = { ...resolved, path: artifact_path, sha256 };

		yield* file_system.writeFileString(
			path.join(target_dir, "metadata.json"),
			`${JSON.stringify(artifact, null, 2)}\n`,
		);

		return artifact;
	});

const ResolveArtifactSource = (
	target: Target,
	repo_root: string,
	target_dir: string,
	artifact_path: string,
	evidence_root: string,
	corepack: string,
) => {
	const source = target.source;

	if (source._tag === "Artifact") {
		return CopyArtifact(source, repo_root, artifact_path);
	}

	if (source._tag === "Package") {
		return DownloadPackageArtifact(source, artifact_path, repo_root, corepack);
	}

	if (source._tag === "Git") {
		return PackGitArtifact(
			source,
			target,
			repo_root,
			target_dir,
			artifact_path,
			evidence_root,
			corepack,
		);
	}

	return Effect.fail(new Error(`Native target ${target.name} does not have an artifact.`));
};

const CopyArtifact = (
	source: Extract<TargetSource, { _tag: "Artifact" }>,
	repo_root: string,
	target: string,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const source_path = path.isAbsolute(source.path)
			? source.path
			: path.resolve(repo_root, source.path);
		const has_source = yield* file_system.exists(source_path);

		if (!has_source) {
			return yield* Effect.fail(new Error(`Packed artifact not found at ${source_path}.`));
		}

		yield* file_system.copyFile(source_path, target);

		const manifest = yield* ReadManifest(
			path.join(repo_root, "modules", "svelte-effect-runtime", "package.json"),
		);

		return {
			source: `artifact:${source_path.replaceAll("\\", "/")}`,
			version: manifest.version,
		};
	});

const DownloadPackageArtifact = (
	source: Extract<TargetSource, { _tag: "Package" }>,
	target: string,
	repo_root: string,
	corepack: string,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const output = yield* RunCommand(
			corepack,
			["pnpm", "view", source.specifier, "dist.tarball", "version", "--json"],
			repo_root,
		);
		const metadata = JSON.parse(output.stdout) as {
			"dist.tarball"?: string;
			dist?: { tarball?: string };
			version?: string;
		};
		const tarball = metadata["dist.tarball"] ?? metadata.dist?.tarball;
		const version = metadata.version;

		if (!tarball || !version) {
			return yield* Effect.fail(
				new Error(
					`Registry metadata for ${source.specifier} did not include a tarball and version.`,
				),
			);
		}

		const bytes = yield* Effect.tryPromise({
			try: async () => {
				const response = await fetch(tarball);

				if (!response.ok) {
					throw new Error(`Downloading ${tarball} failed with ${response.status}.`);
				}

				return new Uint8Array(await response.arrayBuffer());
			},
			catch: (error) => error,
		});

		yield* file_system.writeFile(target, bytes);

		return { source: `package:${source.specifier}`, version };
	});

const PackGitArtifact = (
	source: Extract<TargetSource, { _tag: "Git" }>,
	target: Target,
	repo_root: string,
	target_dir: string,
	artifact_path: string,
	evidence_root: string,
	corepack: string,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const checkout_dir = path.join(target_dir, "checkout");

		yield* EnsureContained(target_dir, checkout_dir);
		yield* RemovePath(checkout_dir);
		yield* RunPhase(
			"git",
			["clone", "--shared", "--no-checkout", repo_root, checkout_dir],
			repo_root,
			evidence_root,
			target.name,
			"artifact-clone",
		);
		yield* RunPhase(
			"git",
			["checkout", "--detach", source.reference],
			checkout_dir,
			evidence_root,
			target.name,
			"artifact-checkout",
		);

		const revision = yield* RunCommand("git", ["rev-parse", "HEAD"], checkout_dir);

		yield* RunPhase(
			corepack,
			["pnpm", "install", "--frozen-lockfile"],
			checkout_dir,
			evidence_root,
			target.name,
			"artifact-install",
		);
		yield* RunPhase(
			corepack,
			["pnpm", "run", "build:runtime"],
			checkout_dir,
			evidence_root,
			target.name,
			"artifact-build",
		);
		yield* RunPhase(
			"vp",
			["node", "build/pack.ts", "svelte-effect-runtime"],
			checkout_dir,
			evidence_root,
			target.name,
			"artifact-pack",
		);

		const manifest = yield* ReadManifest(
			path.join(checkout_dir, "modules", "svelte-effect-runtime", "package.json"),
		);
		const packed_path = path.join(
			checkout_dir,
			".dist",
			"svelte-effect-runtime",
			`svelte-effect-runtime-${manifest.version}.tgz`,
		);

		yield* file_system.copyFile(packed_path, artifact_path);
		yield* RemovePath(checkout_dir);

		return {
			source: `git:${source.reference}`,
			version: manifest.version,
			commit: revision.stdout.trim(),
		};
	});

const PrepareApplication = (
	target: Target,
	artifact: ResolvedArtifact | undefined,
	repo_root: string,
	applications_root: string,
	evidence_root: string,
	sveltekit_version: string,
	corepack: string,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const fixture_dir = path.join(
			repo_root,
			".tests",
			"svelte-effect-runtime",
			"consumer",
			"fixtures",
			target.fixture === "native" ? "native" : "ser",
		);
		const target_adapter_dir = path.join(
			repo_root,
			".tests",
			"svelte-effect-runtime",
			"consumer",
			"fixtures",
			target.fixture,
		);
		const application_dir = path.join(applications_root, target.name);
		const manifest_path = path.join(application_dir, "package.json");
		const adapter_patch_source = path.join(repo_root, "patches", adapter_patch_name);
		const application_patch_dir = path.join(application_dir, "patches");
		const application_patch = path.join(application_patch_dir, adapter_patch_name);

		yield* EnsureContained(applications_root, application_dir);
		yield* RemovePath(application_dir);
		yield* file_system.copy(fixture_dir, application_dir, { overwrite: true });

		if (target.fixture === "stable") {
			yield* file_system.copy(target_adapter_dir, application_dir, { overwrite: true });
		}

		yield* file_system.makeDirectory(application_patch_dir, { recursive: true });
		yield* file_system.copyFile(adapter_patch_source, application_patch);

		let manifest = yield* file_system.readFileString(manifest_path);

		manifest = manifest.replaceAll("__SVELTEKIT_VERSION__", sveltekit_version);

		if (target.fixture !== "native") {
			if (!artifact) {
				return yield* Effect.fail(new Error(`Missing artifact for ${target.name}.`));
			}

			const application_artifact_dir = path.join(application_dir, ".artifacts");
			const application_artifact = path.join(
				application_artifact_dir,
				"svelte-effect-runtime.tgz",
			);

			yield* file_system.makeDirectory(application_artifact_dir, { recursive: true });
			yield* file_system.copyFile(artifact.path, application_artifact);

			manifest = manifest.replaceAll(
				"__SER_TARGET__",
				"file:.artifacts/svelte-effect-runtime.tgz",
			);
		}

		if (manifest.includes("__")) {
			return yield* Effect.fail(
				new Error(`Unresolved fixture placeholder in ${manifest_path}.`),
			);
		}

		yield* file_system.writeFileString(manifest_path, manifest);

		yield* RunPhase(
			corepack,
			["pnpm", "install", "--no-frozen-lockfile"],
			application_dir,
			evidence_root,
			target.name,
			"install",
		);
		yield* RunPhase(
			corepack,
			["pnpm", "run", "sync"],
			application_dir,
			evidence_root,
			target.name,
			"sync",
		);
		yield* RunPhase(
			corepack,
			["pnpm", "run", "types"],
			application_dir,
			evidence_root,
			target.name,
			"types",
		);
		yield* RunPhase(
			corepack,
			["pnpm", "run", "check"],
			application_dir,
			evidence_root,
			target.name,
			"check",
		);
		yield* RunPhase(
			corepack,
			["pnpm", "run", "build"],
			application_dir,
			evidence_root,
			target.name,
			"build",
		);
	});

const RunPhase = (
	command: string,
	args: ReadonlyArray<string>,
	cwd: string,
	evidence_root: string,
	target: TargetName,
	phase: HarnessPhase,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const target_dir = path.join(evidence_root, target);
		const log_path = path.join(target_dir, `${phase}.log`);

		yield* file_system.makeDirectory(target_dir, { recursive: true });

		return yield* RunCommand(command, args, cwd).pipe(
			Effect.tap((output) =>
				file_system.writeFileString(
					log_path,
					[`$ ${command} ${args.join(" ")}`, output.stdout, output.stderr]
						.filter(Boolean)
						.join("\n\n"),
				),
			),
			Effect.catch((error) =>
				file_system
					.writeFileString(
						log_path,
						`$ ${command} ${args.join(" ")}\n\n${String(error)}\n`,
					)
					.pipe(Effect.andThen(Effect.fail(error))),
			),
		);
	});

const ReadManifest = (manifest_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const content = yield* file_system.readFileString(manifest_path);

		return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PackageManifestSchema))(
			content,
		);
	});

const EnsureContained = (root: string, target: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const relative = path.relative(path.resolve(root), path.resolve(target));
		const outside =
			relative === "" ||
			relative === ".." ||
			relative.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relative);

		if (outside) {
			return yield* Effect.fail(new Error(`Refusing to write outside ${root}: ${target}`));
		}
	});

function is_default_candidate(path: string): boolean {
	return (
		path.replaceAll("\\", "/") === ".dist/svelte-effect-runtime/svelte-effect-runtime-4.0.0.tgz"
	);
}

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
