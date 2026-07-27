import type { HarnessPhase, Target, TargetName, TargetSource } from "../../unit/harness/model.ts";
import { get_conformance_proxy_url } from "../../unit/harness/model.ts";
import {
	get_target,
	make_candidate_artifact_source,
	make_targets,
} from "../../unit/harness/target.ts";
import { read_packed_artifact_version } from "./artifact-manifest.ts";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { render_fixture_sveltekit_config } from "./fixture-config.ts";
import { resolve_sveltekit_profiles } from "./sveltekit-profiles.ts";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SvelteKitProfile } from "./sveltekit-profiles.ts";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Schema } from "effect";

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

type ConformanceLayout = {
	readonly is_matrix: boolean;
	readonly metadata_path: "matrix.json" | "targets.json";
	readonly root_directory: "conformance" | "conformance-matrix";
};

class CommandFailure extends Error {
	readonly output: CommandOutput;

	constructor(message: string, output: CommandOutput) {
		super(message);

		this.name = "CommandFailure";
		this.output = output;
	}
}

const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);
const StringRecord = Schema.Record(Schema.String, Schema.String);
const PackageManifestSchema = Schema.Struct({ version: Schema.String });
const RegistryMetadataSchema = Schema.Struct({
	"dist.tarball": Schema.optional(Schema.String),
	dist: Schema.optional(
		Schema.Struct({
			tarball: Schema.optional(Schema.String),
		}),
	),
	version: Schema.optional(Schema.String),
});
const repo_root = fileURLToPath(new URL("../../../../", import.meta.url));

async function main(): Promise<void> {
	const corepack = command_name("corepack");
	const runtime_manifest = await read_manifest(
		join(repo_root, "modules", "svelte-effect-runtime", "package.json"),
	);
	const stable_source = process.env.SER_STABLE_TARGET ?? "package:svelte-effect-runtime@4.0.0";
	const candidate_source =
		process.env.SER_CANDIDATE_TARGET ??
		make_candidate_artifact_source(runtime_manifest.version);
	const layout = resolve_conformance_layout(process.env);
	const profiles = resolve_sveltekit_profiles(process.env);
	const targets = make_targets(stable_source, candidate_source);
	const conformance_root = join(repo_root, ".dist", layout.root_directory);
	const artifacts_root = join(conformance_root, "artifacts");
	const artifact_evidence_root = join(conformance_root, "evidence", "prepare", "artifacts");
	const artifacts = new Map<TargetName, ResolvedArtifact>();
	const candidate = get_target(targets, "candidate");

	/** Prepare an isolated output root before resolving any target artifacts. */
	ensure_contained(repo_root, conformance_root);
	await rm(conformance_root, { force: true, recursive: true });
	await mkdir(conformance_root, { recursive: true });

	if (
		candidate.source._tag === "Artifact" &&
		is_default_candidate(candidate.source.path, runtime_manifest.version)
	) {
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
		const applications_root = get_applications_root(
			conformance_root,
			profile,
			layout.is_matrix,
		);
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

	const metadata = layout.is_matrix ? { profiles: matrix_metadata } : matrix_metadata[0];

	await writeFile(
		join(conformance_root, layout.metadata_path),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);
}

export function resolve_conformance_layout(environment: NodeJS.ProcessEnv): ConformanceLayout {
	const is_matrix = environment.SVELTEKIT_MATRIX === "all";
	const metadata_path = is_matrix ? "matrix.json" : "targets.json";
	const root_directory = is_matrix ? "conformance-matrix" : "conformance";

	return { is_matrix, metadata_path, root_directory };
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

	const version = await read_packed_artifact_version(target, repository_root);

	return {
		source: `artifact:${source_path.replaceAll("\\", "/")}`,
		version,
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
	const metadata = Schema.decodeUnknownSync(RegistryMetadataSchema)(JSON.parse(output.stdout));
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
	const revision = await resolve_git_revision(repository_root, source.reference);

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
		["checkout", "--detach", revision],
		checkout_dir,
		evidence_root,
		target.name,
		"artifact-checkout",
	);

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
		commit: revision,
	};
}

export async function resolve_git_revision(
	repository_root: string,
	reference: string,
): Promise<string> {
	const revision = await run_command(
		"git",
		["rev-parse", "--verify", `${reference}^{commit}`],
		repository_root,
	);

	return revision.stdout.trim();
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
	const config_path = join(application_dir, "vite.config.ts");
	const workspace_path = join(application_dir, "pnpm-workspace.yaml");
	const checker_path = join(application_dir, ".harness", "check-svelte.ts");

	ensure_contained(applications_root, application_dir);
	await rm(application_dir, { force: true, recursive: true });
	await cp(fixture_dir, application_dir, { force: true, recursive: true });
	await mkdir(join(application_dir, ".harness"), { recursive: true });
	await cp(
		join(
			repository_root,
			".tests",
			"svelte-effect-runtime",
			"consumer",
			"harness",
			"check-svelte.ts",
		),
		checker_path,
	);

	/**
	 * Only the candidate application receives the candidate overlay. The stable
	 * application shares the candidate fixture name but runs the released
	 * package, which cannot satisfy overlay files that exercise unreleased API.
	 */
	if (target.name === "candidate") {
		await cp(target_adapter_dir, application_dir, { force: true, recursive: true });

		if (!profile.supports_explicit_environment) {
			await remove_explicit_environment_fixture(application_dir);
		}
	}

	await prepare_adapter_workspace(workspace_path);

	const config_source = await readFile(config_path, "utf8");
	const rendered_config = render_fixture_sveltekit_config(
		config_source,
		get_conformance_proxy_url(target.name),
		profile,
		config_path,
	);

	if (rendered_config.includes("__")) {
		throw new Error(`Unresolved fixture placeholder in ${config_path}.`);
	}

	await writeFile(config_path, rendered_config);

	const manifest_source = await readFile(manifest_path, "utf8");
	const manifest_record = Schema.decodeUnknownSync(JsonRecord)(JSON.parse(manifest_source));
	const dependencies = Schema.decodeUnknownSync(StringRecord)(manifest_record.dependencies);
	const manifest = { ...manifest_record, dependencies: { ...dependencies } };

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

	await write_application_inventory(application_dir, evidence_root, target.name);

	await run_phase(
		corepack,
		["pnpm", "install", "--no-frozen-lockfile"],
		application_dir,
		evidence_root,
		target.name,
		"install",
	);

	if (artifact) {
		const installed_manifest = await read_manifest(
			join(application_dir, "node_modules", "svelte-effect-runtime", "package.json"),
		);

		if (installed_manifest.version !== artifact.version) {
			throw new Error(
				`Installed ${target.name} artifact version ${installed_manifest.version} does not match recorded version ${artifact.version}.`,
			);
		}
	}

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

	if (profile.adapter_output_directory_module) {
		await verify_adapter_output(application_dir, profile.adapter_output_directory_module);
	}
}

async function verify_adapter_output(
	application_dir: string,
	directory_module_name: string,
): Promise<void> {
	const build_dir = join(application_dir, "build");
	const client_version = join(application_dir, "build", "client", "_app", "version.json");
	const directory_module = join(build_dir, directory_module_name);

	try {
		await Promise.all([readFile(client_version), readFile(directory_module)]);
	} catch {
		throw new Error(`Adapter output must contain ${client_version} and ${directory_module}.`);
	}

	const directory_exports = Object.values(await import(pathToFileURL(directory_module).href));
	const resolves_to_build = directory_exports.some(
		(directory) => typeof directory === "string" && resolve(directory) === resolve(build_dir),
	);

	if (!resolves_to_build) {
		throw new Error(`Adapter output must resolve its static root to ${build_dir}.`);
	}
}

/** Remove environment fixture files on SvelteKit versions without explicit environment variables. */
async function remove_explicit_environment_fixture(application_dir: string): Promise<void> {
	const environment_paths = [
		join(application_dir, "src", "env.ts"),
		join(application_dir, "src", "lib", "components", "environment-page.svelte"),
		join(application_dir, "src", "routes", "environment"),
		join(application_dir, "src", "routes", "api", "environment"),
	];

	await Promise.all(environment_paths.map((path) => rm(path, { force: true, recursive: true })));
}

/** Record the application's source tree so evidence shows what each phase ran against. */
async function write_application_inventory(
	application_dir: string,
	evidence_root: string,
	target: TargetName,
): Promise<void> {
	const skipped = new Set(["node_modules", ".artifacts", ".harness", ".svelte-kit"]);
	const files = await list_application_files(application_dir, application_dir, skipped);
	const target_dir = join(evidence_root, target);

	await mkdir(target_dir, { recursive: true });
	await writeFile(join(target_dir, "inventory.txt"), `${files.sort().join("\n")}\n`);
}

async function list_application_files(
	root: string,
	directory: string,
	skipped: ReadonlySet<string>,
): Promise<ReadonlyArray<string>> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			if (skipped.has(entry.name)) {
				return Promise.resolve<ReadonlyArray<string>>([]);
			}

			const path = join(directory, entry.name);

			if (entry.isDirectory()) {
				return list_application_files(root, path, skipped);
			}

			return Promise.resolve([relative(root, path).replaceAll("\\", "/")]);
		}),
	);

	return nested.flat();
}

async function prepare_adapter_workspace(workspace_path: string): Promise<void> {
	const workspace = [
		"allowBuilds:",
		"    esbuild: true",
		"    msgpackr-extract: true",
		"",
		"packages: []",
		"",
	].join("\n");

	await writeFile(workspace_path, workspace);
}

function get_applications_root(
	conformance_root: string,
	profile: SvelteKitProfile,
	is_matrix: boolean,
): string {
	if (!is_matrix) {
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
	const manifest = Schema.decodeUnknownSync(PackageManifestSchema)(JSON.parse(content));

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

function is_default_candidate(path: string, version: string): boolean {
	const source = make_candidate_artifact_source(version);
	const expected_path = source.slice("artifact:".length);

	return path.replaceAll("\\", "/") === expected_path;
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

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;

if (entrypoint === resolve(fileURLToPath(import.meta.url))) {
	await main();
}
