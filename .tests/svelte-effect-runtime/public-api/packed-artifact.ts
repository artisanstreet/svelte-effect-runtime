import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

export type PackedArtifact = {
	readonly fingerprint: string;
	readonly path: string;
};

export type CommandResult = {
	readonly status: number;
	readonly stderr: string;
	readonly stdout: string;
};

export type DirectoryLockOptions = {
	readonly retry_ms: number;
	readonly stale_after_ms: number;
	readonly timeout_ms: number;
};

const StringRecord = Schema.Record(Schema.String, Schema.String);
const PackageManifestSchema = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
});
const DirectoryLockOwnerSchema = Schema.Struct({ pid: Schema.Number });
const repo_root = fileURLToPath(new URL("../../..", import.meta.url));
const contract_root = join(repo_root, ".tmp", "packed-contracts");
const artifact_root = join(contract_root, "artifacts");
const build_lock = join(contract_root, "build.lock");
const fingerprint_paths = [
	"build/dts.ts",
	"build/node-utils.ts",
	"build/pack.ts",
	"build/runtime.ts",
	"LICENSE",
	"modules/svelte-effect-runtime/package.json",
	"modules/svelte-effect-runtime/README.md",
	"modules/svelte-effect-runtime/src",
	"modules/svelte-effect-runtime/tsconfig.build.json",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
] as const;

let artifact_promise: Promise<PackedArtifact> | undefined;

export function get_repo_root(): string {
	return repo_root;
}

export function ensure_packed_artifact(): Promise<PackedArtifact> {
	artifact_promise ??= prepare_packed_artifact();

	return artifact_promise;
}

export async function prepare_workspace(
	name: string,
	artifact: PackedArtifact,
	manifest: Readonly<Record<string, unknown>>,
): Promise<string> {
	const workspace = join(contract_root, "workspaces", `${artifact.fingerprint}-${name}`);
	const dependencies =
		manifest.dependencies === undefined
			? {}
			: Schema.decodeUnknownSync(StringRecord)(manifest.dependencies);
	const package_json = {
		...manifest,
		dependencies: {
			...dependencies,
			"svelte-effect-runtime": `file:${artifact.path.replaceAll("\\", "/")}`,
		},
	};

	await rm(workspace, { force: true, recursive: true });
	await mkdir(workspace, { recursive: true });
	await writeFile(join(workspace, "package.json"), `${JSON.stringify(package_json, null, 2)}\n`);

	const install = run_command(
		"corepack",
		[
			"pnpm",
			"install",
			"--ignore-workspace",
			"--ignore-scripts",
			"--frozen-lockfile=false",
			"--prefer-offline",
		],
		workspace,
	);

	assert_command_succeeded("install packed artifact", install);

	return workspace;
}

export async function read_primary_dependency_versions(): Promise<
	Readonly<Record<string, string>>
> {
	const dependency_names = [
		"@sveltejs/kit",
		"@sveltejs/vite-plugin-svelte",
		"@types/node",
		"effect",
		"svelte",
		"typescript",
		"vite",
	] as const;
	const versions = await Promise.all(
		dependency_names.map(async (name) => {
			const package_path = join(
				repo_root,
				"node_modules",
				...name.split("/"),
				"package.json",
			);
			const manifest = Schema.decodeUnknownSync(PackageManifestSchema)(
				JSON.parse(await readFile(package_path, "utf8")),
			);

			return [name, manifest.version] as const;
		}),
	);

	return Object.fromEntries(versions);
}

export function run_command(
	command: string,
	arguments_: readonly string[],
	cwd: string,
): CommandResult {
	const uses_windows_corepack = process.platform === "win32" && command === "corepack";
	const executable = uses_windows_corepack ? process.execPath : command;
	const resolved_arguments = uses_windows_corepack
		? [
				join(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js"),
				...arguments_,
			]
		: arguments_;
	const output = spawnSync(executable, resolved_arguments, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			CI: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	return {
		status: output.status ?? 1,
		stderr: output.stderr ?? output.error?.message ?? "",
		stdout: output.stdout ?? "",
	};
}

export function assert_command_succeeded(phase: string, result: CommandResult): void {
	if (result.status === 0) {
		return;
	}

	throw new Error(
		`${phase} failed with status ${result.status}.\n${result.stdout}${result.stderr}`,
	);
}

export async function resolve_installed_package_root(workspace: string): Promise<string> {
	const probe = [
		"import { createRequire } from 'node:module';",
		"import { dirname } from 'node:path';",
		"const require = createRequire(new URL('./package.json', import.meta.url));",
		"console.log(dirname(dirname(require.resolve('svelte-effect-runtime'))));",
	].join("\n");
	const result = run_command(
		process.execPath,
		["--input-type=module", "--eval", probe],
		workspace,
	);

	assert_command_succeeded("resolve installed package", result);

	return realpath(result.stdout.trim());
}

export async function publish_packed_artifact(
	packed_path: string,
	artifact_path: string,
): Promise<void> {
	const temporary_path = `${artifact_path}.${process.pid}-${randomUUID()}.tmp`;

	try {
		await copyFile(packed_path, temporary_path);

		try {
			await rename(temporary_path, artifact_path);
		} catch (error) {
			if (!(await path_exists(artifact_path))) {
				throw error;
			}
		}
	} finally {
		await rm(temporary_path, { force: true });
	}
}

async function prepare_packed_artifact(): Promise<PackedArtifact> {
	const fingerprint = await make_source_fingerprint();
	const artifact_path = join(artifact_root, `svelte-effect-runtime-${fingerprint}.tgz`);

	await mkdir(artifact_root, { recursive: true });

	if (await path_exists(artifact_path)) {
		return { fingerprint, path: artifact_path };
	}

	await acquire_build_lock();

	try {
		if (await path_exists(artifact_path)) {
			return { fingerprint, path: artifact_path };
		}

		/** Build declarations and JavaScript exactly as the release package does. */
		const build = run_command("corepack", ["pnpm", "run", "build:runtime"], repo_root);

		assert_command_succeeded("build runtime package", build);

		/** Pack from the release staging path so workspace aliases cannot leak in. */
		const pack = run_command(
			"vp",
			["node", "build/pack.ts", "svelte-effect-runtime"],
			repo_root,
		);

		assert_command_succeeded("pack runtime package", pack);

		const manifest = Schema.decodeUnknownSync(PackageManifestSchema)(
			JSON.parse(
				await readFile(
					join(repo_root, "modules", "svelte-effect-runtime", "package.json"),
					"utf8",
				),
			),
		);
		const packed_path = join(
			repo_root,
			".dist",
			"svelte-effect-runtime",
			`${manifest.name}-${manifest.version}.tgz`,
		);

		await publish_packed_artifact(packed_path, artifact_path);

		return { fingerprint, path: artifact_path };
	} finally {
		await rm(build_lock, { force: true, recursive: true });
	}
}

async function make_source_fingerprint(): Promise<string> {
	const hash = createHash("sha256");

	for (const path of fingerprint_paths) {
		const absolute_path = join(repo_root, path);
		const files = await collect_files(absolute_path);

		for (const file of files) {
			hash.update(relative(repo_root, file).replaceAll("\\", "/"));
			hash.update(await readFile(file));
		}
	}

	return hash.digest("hex").slice(0, 16);
}

async function collect_files(path: string): Promise<readonly string[]> {
	const information = await stat(path);

	if (information.isFile()) {
		return [path];
	}

	const entries = await readdir(path, { withFileTypes: true });
	const files = await Promise.all(
		entries
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((entry) => collect_files(join(path, entry.name))),
	);

	return files.flat();
}

async function acquire_build_lock(): Promise<void> {
	await acquire_directory_lock(build_lock, {
		retry_ms: 100,
		stale_after_ms: 180_000,
		timeout_ms: 180_000,
	});
}

export async function acquire_directory_lock(
	lock_path: string,
	options: DirectoryLockOptions,
): Promise<void> {
	const timeout_at = Date.now() + options.timeout_ms;
	const owner_path = join(lock_path, "owner.json");

	while (Date.now() < timeout_at) {
		try {
			await mkdir(lock_path);

			try {
				await writeFile(owner_path, `${JSON.stringify({ pid: process.pid })}\n`);
			} catch (error) {
				await rm(lock_path, { force: true, recursive: true });

				throw error;
			}

			return;
		} catch (error) {
			if (!is_file_exists_error(error)) {
				throw error;
			}

			if (await reclaim_abandoned_directory_lock(lock_path, options.stale_after_ms)) {
				continue;
			}

			await delay(options.retry_ms);
		}
	}

	throw new Error(`Timed out waiting for the directory lock at ${lock_path}.`);
}

async function reclaim_abandoned_directory_lock(
	lock_path: string,
	stale_after_ms: number,
): Promise<boolean> {
	const recovery_lock_path = `${lock_path}.recovery`;

	try {
		await mkdir(recovery_lock_path);
	} catch (error) {
		if (is_file_exists_error(error)) {
			return false;
		}

		throw error;
	}

	try {
		if (!(await is_abandoned_directory_lock(lock_path, stale_after_ms))) {
			return false;
		}

		await rm(lock_path, { force: true, recursive: true });

		return true;
	} finally {
		await rm(recovery_lock_path, { force: true, recursive: true });
	}
}

async function is_abandoned_directory_lock(
	lock_path: string,
	stale_after_ms: number,
): Promise<boolean> {
	let information;

	try {
		information = await stat(lock_path);
	} catch (error) {
		if (is_not_found_error(error)) {
			return false;
		}

		throw error;
	}

	if (Date.now() - information.mtimeMs <= stale_after_ms) {
		return false;
	}

	let owner_source;

	try {
		owner_source = await readFile(join(lock_path, "owner.json"), "utf8");
	} catch (error) {
		if (is_not_found_error(error)) {
			return true;
		}

		throw error;
	}

	let owner;

	try {
		owner = Schema.decodeUnknownSync(DirectoryLockOwnerSchema)(JSON.parse(owner_source));
	} catch {
		return true;
	}

	return !is_process_running(owner.pid);
}

function is_process_running(pid: number): boolean {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		if (has_error_code(error, "ESRCH")) {
			return false;
		}

		if (has_error_code(error, "EPERM")) {
			return true;
		}

		throw error;
	}
}

async function path_exists(path: string): Promise<boolean> {
	try {
		await stat(path);

		return true;
	} catch (error) {
		if (is_not_found_error(error)) {
			return false;
		}

		throw error;
	}
}

function is_file_exists_error(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function is_not_found_error(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function has_error_code(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}
