import type { HarnessPhase, Target, TargetName, TargetSource } from "../../unit/harness/model.ts";
import type { SvelteKitProfile } from "./sveltekit-profiles.ts";
import { get_target, make_targets } from "../../unit/harness/target.ts";
import { resolve_sveltekit_profiles } from "./sveltekit-profiles.ts";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

type ResolvedArtifact = {
	readonly path: string;
	readonly sha256: string;
	readonly source: string;
	readonly version: string;
	readonly commit?: string;
};

type CommandOutput = {
	readonly stderr: string;
	readonly stdout: string;
};

type PackageManifest = {
	readonly version: string;
};

type ConsumerManifest = {
	readonly dependencies: Record<string, string>;
};

class CommandFailure extends Error {
	readonly output: CommandOutput;

	constructor(message: string, output: CommandOutput) {
		super(message);

		this.name = "CommandFailure";
		this.output = output;
	}
}

const repo_root = fileURLToPath(new URL("../../../../", import.meta.url));

async function main(): Promise<void> {
	const corepack = command_name("corepack");
	const stable_source = process.env.SER_STABLE_TARGET ?? "package:svelte-effect-runtime@4.0.0";
	const candidate_source =
		process.env.SER_CANDIDATE_TARGET ??
		"artifact:.dist/svelte-effect-runtime/svelte-effect-runtime-4.0.0.tgz";
	const profiles = resolve_sveltekit_profiles(process.env);
	const targets = make_targets(stable_source, candidate_source);
	const conformance_root = join(
		repo_root,
		".dist",
		profiles.length === 1 ? "conformance" : "conformance-matrix",
	);
	const artifacts_root = join(conformance_root, "artifacts");
	const artifact_evidence_root = join(conformance_root, "evidence", "prepare", "artifacts");
	const artifacts = new Map<TargetName, ResolvedArtifact>();
	const candidate = get_target(targets, "candidate");

	/** Prepare an isolated output root before resolving any target artifacts. */
	ensure_contained(repo_root, conformance_root);
	await rm(conformance_root, { force: true, recursive: true });
	await mkdir(conformance_root, { recursive: true });

	if (candidate.source._tag === "Artifact" && is_default_candidate(candidate.source.path)) {
		await run_phase(
			corepack,
			["pnpm", "run", "build:runtime"],
			repo_root,
			artifact_evidence_root,
			"candidate",
			"artifact-build",
		);
		await run_phase(
			"vp",
			["node", "build/pack.ts", "svelte-effect-runtime"],
			repo_root,
			artifact_evidence_root,
			"candidate",
			"artifact-pack",
		);
	}

	/** Resolve stable and candidate sources into immutable local tarballs. */
	for (const target of targets) {
		if (target.source._tag === "Native") {
			continue;
		}

		const artifact = await resolve_artifact(
			target,
			repo_root,
			artifacts_root,
			artifact_evidence_root,
			corepack,
		);

		artifacts.set(target.name, artifact);
	}

	const matrix_metadata = [];

	/** Install and verify every target under each requested compatibility profile. */
	for (const profile of profiles) {
		const applications_root = get_applications_root(conformance_root, profile, profiles.length);
		const evidence_root = join(
			conformance_root,
			"evidence",
			"prepare",
			profile.name,
			profile.sveltekit_version,
		);

		for (const target of targets) {
			await prepare_application(
				target,
				artifacts.get(target.name),
				repo_root,
				applications_root,
				evidence_root,
				profile,
				corepack,
			);
		}

		matrix_metadata.push({
			profile,
			targets: targets.map((target) => ({
				name: target.name,
				fixture: target.fixture,
				source: target.source,
				artifact: artifacts.get(target.name),
				application: join(applications_root, target.name).replaceAll("\\", "/"),
			})),
		});

		console.log(
			`Prepared native, stable, and candidate conformance applications for ${profile.name} (SvelteKit ${profile.sveltekit_version}, adapter-node ${profile.adapter_node_version}).`,
		);
	}

	const metadata_path = profiles.length === 1 ? "targets.json" : "matrix.json";
	const metadata = profiles.length === 1 ? matrix_metadata[0] : { profiles: matrix_metadata };

	await writeFile(
		join(conformance_root, metadata_path),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);
}

async function resolve_artifact(
	target: Target,
	repository_root: string,
	artifacts_root: string,
	evidence_root: string,
	corepack: string,
): Promise<ResolvedArtifact> {
	const target_dir = join(artifacts_root, target.name);
	const artifact_path = join(target_dir, "svelte-effect-runtime.tgz");

	await mkdir(target_dir, { recursive: true });

	const resolved = await resolve_artifact_source(
		target,
		repository_root,
		target_dir,
		artifact_path,
		evidence_root,
		corepack,
	);
	const bytes = await readFile(artifact_path);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const artifact = { ...resolved, path: artifact_path, sha256 };

	await writeFile(join(target_dir, "metadata.json"), `${JSON.stringify(artifact, null, 2)}\n`);

	return artifact;
}

function resolve_artifact_source(
	target: Target,
	repository_root: string,
	target_dir: string,
	artifact_path: string,
	evidence_root: string,
	corepack: string,
): Promise<Omit<ResolvedArtifact, "path" | "sha256">> {
	const source = target.source;

	if (source._tag === "Artifact") {
		return copy_artifact(source, repository_root, artifact_path);
	}

	if (source._tag === "Package") {
		return download_package_artifact(source, artifact_path, repository_root, corepack);
	}

	if (source._tag === "Git") {
		return pack_git_artifact(
			source,
			target,
			repository_root,
			target_dir,
			artifact_path,
			evidence_root,
			corepack,
		);
	}

	return Promise.reject(new Error(`Native target ${target.name} does not have an artifact.`));
}

async function copy_artifact(
	source: Extract<TargetSource, { _tag: "Artifact" }>,
	repository_root: string,
	target: string,
): Promise<Omit<ResolvedArtifact, "path" | "sha256">> {
	const source_path = isAbsolute(source.path)
		? source.path
		: resolve(repository_root, source.path);

	try {
		await readFile(source_path);
	} catch {
		throw new Error(`Packed artifact not found at ${source_path}.`);
	}

	await cp(source_path, target);

	const manifest = await read_manifest(
		join(repository_root, "modules", "svelte-effect-runtime", "package.json"),
	);

	return {
		source: `artifact:${source_path.replaceAll("\\", "/")}`,
		version: manifest.version,
	};
}

async function download_package_artifact(
	source: Extract<TargetSource, { _tag: "Package" }>,
	target: string,
	repository_root: string,
	corepack: string,
): Promise<Omit<ResolvedArtifact, "path" | "sha256">> {
	const output = await run_command(
		corepack,
		["pnpm", "view", source.specifier, "dist.tarball", "version", "--json"],
		repository_root,
	);
	const metadata = JSON.parse(output.stdout) as {
		"dist.tarball"?: string;
		dist?: { tarball?: string };
		version?: string;
	};
	const tarball = metadata["dist.tarball"] ?? metadata.dist?.tarball;
	const version = metadata.version;

	if (!tarball || !version) {
		throw new Error(
			`Registry metadata for ${source.specifier} did not include a tarball and version.`,
		);
	}

	const response = await fetch(tarball);

	if (!response.ok) {
		throw new Error(`Downloading ${tarball} failed with ${response.status}.`);
	}

	await writeFile(target, new Uint8Array(await response.arrayBuffer()));

	return { source: `package:${source.specifier}`, version };
}

async function pack_git_artifact(
	source: Extract<TargetSource, { _tag: "Git" }>,
	target: Target,
	repository_root: string,
	target_dir: string,
	artifact_path: string,
	evidence_root: string,
	corepack: string,
): Promise<Omit<ResolvedArtifact, "path" | "sha256">> {
	const checkout_dir = join(target_dir, "checkout");

	ensure_contained(target_dir, checkout_dir);
	await rm(checkout_dir, { force: true, recursive: true });
	await run_phase(
		"git",
		["clone", "--shared", "--no-checkout", repository_root, checkout_dir],
		repository_root,
		evidence_root,
		target.name,
		"artifact-clone",
	);
	await run_phase(
		"git",
		["checkout", "--detach", source.reference],
		checkout_dir,
		evidence_root,
		target.name,
		"artifact-checkout",
	);

	const revision = await run_command("git", ["rev-parse", "HEAD"], checkout_dir);

	await run_phase(
		corepack,
		["pnpm", "install", "--frozen-lockfile"],
		checkout_dir,
		evidence_root,
		target.name,
		"artifact-install",
	);
	await run_phase(
		corepack,
		["pnpm", "run", "build:runtime"],
		checkout_dir,
		evidence_root,
		target.name,
		"artifact-build",
	);
	await run_phase(
		"vp",
		["node", "build/pack.ts", "svelte-effect-runtime"],
		checkout_dir,
		evidence_root,
		target.name,
		"artifact-pack",
	);

	const manifest = await read_manifest(
		join(checkout_dir, "modules", "svelte-effect-runtime", "package.json"),
	);
	const packed_path = join(
		checkout_dir,
		".dist",
		"svelte-effect-runtime",
		`svelte-effect-runtime-${manifest.version}.tgz`,
	);

	await cp(packed_path, artifact_path);
	await rm(checkout_dir, { force: true, recursive: true });

	return {
		source: `git:${source.reference}`,
		version: manifest.version,
		commit: revision.stdout.trim(),
	};
}

async function prepare_application(
	target: Target,
	artifact: ResolvedArtifact | undefined,
	repository_root: string,
	applications_root: string,
	evidence_root: string,
	profile: SvelteKitProfile,
	corepack: string,
): Promise<void> {
	const fixture_dir = join(
		repository_root,
		".tests",
		"svelte-effect-runtime",
		"consumer",
		"fixtures",
		target.fixture === "native" ? "native" : "ser",
	);
	const target_adapter_dir = join(
		repository_root,
		".tests",
		"svelte-effect-runtime",
		"consumer",
		"fixtures",
		target.fixture,
	);
	const application_dir = join(applications_root, target.name);
	const manifest_path = join(application_dir, "package.json");
	const workspace_path = join(application_dir, "pnpm-workspace.yaml");

	ensure_contained(applications_root, application_dir);
	await rm(application_dir, { force: true, recursive: true });
	await cp(fixture_dir, application_dir, { force: true, recursive: true });

	if (target.fixture === "stable") {
		await cp(target_adapter_dir, application_dir, { force: true, recursive: true });
	}

	await prepare_adapter_workspace(repository_root, application_dir, workspace_path, profile);

	const manifest_source = await readFile(manifest_path, "utf8");
	const manifest = JSON.parse(manifest_source) as ConsumerManifest;

	manifest.dependencies["@sveltejs/kit"] = profile.sveltekit_version;
	manifest.dependencies["@sveltejs/adapter-node"] = profile.adapter_node_version;

	if (target.fixture !== "native") {
		if (!artifact) {
			throw new Error(`Missing artifact for ${target.name}.`);
		}

		const application_artifact_dir = join(application_dir, ".artifacts");
		const application_artifact = join(application_artifact_dir, "svelte-effect-runtime.tgz");

		await mkdir(application_artifact_dir, { recursive: true });
		await cp(artifact.path, application_artifact);

		manifest.dependencies["svelte-effect-runtime"] =
			"file:.artifacts/svelte-effect-runtime.tgz";
	}

	const rendered_manifest = `${JSON.stringify(manifest, null, "\t")}\n`;

	if (rendered_manifest.includes("__")) {
		throw new Error(`Unresolved fixture placeholder in ${manifest_path}.`);
	}

	await writeFile(manifest_path, rendered_manifest);

	await run_phase(
		corepack,
		["pnpm", "install", "--no-frozen-lockfile"],
		application_dir,
		evidence_root,
		target.name,
		"install",
	);
	await run_phase(
		corepack,
		["pnpm", "run", "sync"],
		application_dir,
		evidence_root,
		target.name,
		"sync",
	);
	await run_phase(
		corepack,
		["pnpm", "run", "types"],
		application_dir,
		evidence_root,
		target.name,
		"types",
	);
	await run_phase(
		corepack,
		["pnpm", "run", "check"],
		application_dir,
		evidence_root,
		target.name,
		"check",
	);
	await run_phase(
		corepack,
		["pnpm", "run", "build"],
		application_dir,
		evidence_root,
		target.name,
		"build",
	);
}

async function prepare_adapter_workspace(
	repository_root: string,
	application_dir: string,
	workspace_path: string,
	profile: SvelteKitProfile,
): Promise<void> {
	const patched_dependencies = profile.adapter_patch_name
		? [
				"",
				"patchedDependencies:",
				`    "@sveltejs/adapter-node@${profile.adapter_node_version}": patches/${profile.adapter_patch_name}`,
			]
		: [];
	const workspace = [
		"allowBuilds:",
		"    esbuild: true",
		"    msgpackr-extract: true",
		"",
		"packages: []",
		...patched_dependencies,
		"",
	].join("\n");

	await writeFile(workspace_path, workspace);

	if (!profile.adapter_patch_name) {
		return;
	}

	const adapter_patch_source = join(repository_root, "patches", profile.adapter_patch_name);
	const application_patch_dir = join(application_dir, "patches");
	const application_patch = join(application_patch_dir, profile.adapter_patch_name);

	await mkdir(application_patch_dir, { recursive: true });
	await cp(adapter_patch_source, application_patch);
}

function get_applications_root(
	conformance_root: string,
	profile: SvelteKitProfile,
	profile_count: number,
): string {
	if (profile_count === 1) {
		return join(conformance_root, "applications");
	}

	return join(conformance_root, "matrix", profile.name, "applications");
}

async function run_phase(
	command: string,
	arguments_: ReadonlyArray<string>,
	cwd: string,
	evidence_root: string,
	target: TargetName,
	phase: HarnessPhase,
): Promise<CommandOutput> {
	const target_dir = join(evidence_root, target);
	const log_path = join(target_dir, `${phase}.log`);

	await mkdir(target_dir, { recursive: true });

	try {
		const output = await run_command(command, arguments_, cwd);
		const log = [`$ ${command} ${arguments_.join(" ")}`, output.stdout, output.stderr]
			.filter(Boolean)
			.join("\n\n");

		await writeFile(log_path, log);

		return output;
	} catch (error) {
		const output = error instanceof CommandFailure ? error.output : undefined;
		const log = [
			`$ ${command} ${arguments_.join(" ")}`,
			output?.stdout,
			output?.stderr,
			String(error),
		]
			.filter(Boolean)
			.join("\n\n");

		await writeFile(log_path, `${log}\n`);

		throw error;
	}
}

async function run_command(
	command: string,
	arguments_: ReadonlyArray<string>,
	cwd: string,
): Promise<CommandOutput> {
	const spawn_config = resolve_spawn_config(command, arguments_);

	return await new Promise<CommandOutput>((resolve_command, reject_command) => {
		const child = spawn(spawn_config.command, spawn_config.arguments_, {
			cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];

		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", reject_command);
		child.on("close", (code) => {
			const output = {
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			};

			if (code === 0) {
				resolve_command(output);

				return;
			}

			const message = [
				`${command} ${arguments_.join(" ")} failed`,
				output.stdout.trim(),
				output.stderr.trim(),
			]
				.filter(Boolean)
				.join("\n\n");

			reject_command(new CommandFailure(message, output));
		});
	});
}

async function read_manifest(manifest_path: string): Promise<PackageManifest> {
	const content = await readFile(manifest_path, "utf8");
	const manifest = JSON.parse(content) as Partial<PackageManifest>;

	if (typeof manifest.version !== "string") {
		throw new Error(`Package manifest ${manifest_path} does not declare a string version.`);
	}

	return { version: manifest.version };
}

function ensure_contained(root: string, target: string): void {
	const relative_path = relative(resolve(root), resolve(target));
	const outside =
		relative_path === "" ||
		relative_path === ".." ||
		relative_path.startsWith(`..${sep}`) ||
		isAbsolute(relative_path);

	if (outside) {
		throw new Error(`Refusing to write outside ${root}: ${target}`);
	}
}

function is_default_candidate(path: string): boolean {
	return (
		path.replaceAll("\\", "/") === ".dist/svelte-effect-runtime/svelte-effect-runtime-4.0.0.tgz"
	);
}

function command_name(command: string): string {
	return process.platform === "win32" ? `${command}.cmd` : command;
}

function resolve_spawn_config(
	command: string,
	arguments_: ReadonlyArray<string>,
): { readonly arguments_: ReadonlyArray<string>; readonly command: string } {
	if (process.platform !== "win32" || !command.endsWith(".cmd")) {
		return { command, arguments_ };
	}

	return {
		command: process.env.ComSpec ?? "cmd.exe",
		arguments_: [
			"/d",
			"/s",
			"/c",
			[command, ...arguments_].map(quote_windows_argument).join(" "),
		],
	};
}

function quote_windows_argument(argument: string): string {
	if (!/[\s"&|<>^]/.test(argument)) {
		return argument;
	}

	return `"${argument.replaceAll('"', '\\"')}"`;
}

await main();
