import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import process from "node:process";

const exec_file = promisify(execFile);

const INSTALL_ARTIFACTS = [
	"node_modules",
	".pnp.cjs",
	".pnp.loader.mjs",
	".yarn",
	"aube-lock.yaml",
	"bun.lock",
	"bun.lockb",
	"deno.lock",
	"npm-shrinkwrap.json",
	"nub.lock",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
];

/**
 * Command line invocation for a package manager probe or install step.
 *
 * @example
 * ```ts
 * const invocation: CommandInvocation = {
 *   command: "pnpm",
 *   args: ["install", "--prod"],
 * };
 * ```
 *
 * @since 3.4.9
 */
export interface CommandInvocation {
	/** Executable or shell command to run. */
	command: string;
	/** Arguments passed to the executable. */
	args: string[];
	/** Environment overrides applied on top of the extension host env. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Result captured from a package-manager command.
 *
 * @example
 * ```ts
 * const result: PackageManagerCommandResult = { stdout: "11.10.0", stderr: "" };
 * ```
 *
 * @since 3.4.9
 */
export interface PackageManagerCommandResult {
	/** Standard output captured from the command. */
	stdout: string;
	/** Standard error captured from the command. */
	stderr: string;
}

/**
 * Function used to execute package-manager commands.
 *
 * @example
 * ```ts
 * const runner: PackageManagerCommandRunner = async (invocation) => {
 *   return { stdout: invocation.command, stderr: "" };
 * };
 * ```
 *
 * @since 3.4.9
 */
export type PackageManagerCommandRunner = (
	invocation: CommandInvocation,
	cwd?: string,
) => Promise<PackageManagerCommandResult>;

/**
 * Candidate package manager that can install the language-server dependency.
 *
 * @example
 * ```ts
 * const [candidate] = make_package_manager_candidates("linux");
 * const install = candidate.install("1.0.0");
 * ```
 *
 * @since 3.4.9
 */
export interface PackageManagerCandidate {
	/** Human-readable package-manager name shown in logs and errors. */
	name: string;
	/** Command used to check whether the package manager exists. */
	probe: CommandInvocation;
	/** Creates the install command from the probe output. */
	install: (version_output: string) => CommandInvocation;
}

/**
 * Sink for package-manager installer progress.
 *
 * @example
 * ```ts
 * const reporter: PackageManagerInstallReporter = {
 *   appendLine: console.log,
 * };
 * ```
 *
 * @since 3.4.9
 */
export interface PackageManagerInstallReporter {
	/** Records one installer progress line. */
	appendLine(message: string): void;
}

/**
 * Options for the package-manager fallback installer.
 *
 * @example
 * ```ts
 * await run_package_manager_install({
 *   install_root,
 *   verify_install: async () => assert.ok(true),
 * });
 * ```
 *
 * @since 3.4.9
 */
export interface PackageManagerInstallOptions {
	/** Directory containing the generated package.json to install. */
	install_root: string;
	/** Optional progress reporter. */
	reporter?: PackageManagerInstallReporter;
	/** Candidate package managers to try, primarily used by tests. */
	candidates?: PackageManagerCandidate[];
	/** Command runner override, primarily used by tests. */
	run_command?: PackageManagerCommandRunner;
	/** Install-state cleanup override, primarily used by tests. */
	clean_install_root?: (install_root: string) => Promise<void>;
	/** Verifies that a completed install produced the expected server files. */
	verify_install: () => Promise<void>;
}

interface PackageManagerAttempt {
	name: string;
	phase: "install" | "probe" | "verify";
	message: string;
}

/**
 * Creates the supported package-manager candidates in fallback order.
 *
 * @example
 * ```ts
 * const candidates = make_package_manager_candidates(process.platform);
 * ```
 *
 * @since 3.4.9
 * @param platform - Node platform string used to choose Windows command
 *   wrapping for package-manager shims.
 * @returns Package-manager candidates from preferred modern tools through npm.
 */
export function make_package_manager_candidates(
	platform: NodeJS.Platform = process.platform,
): PackageManagerCandidate[] {
	return [
		make_candidate(platform, "nub", "nub", ["--version"], () => ["install"]),
		make_candidate(platform, "aube", "aube", ["--version"], () => ["install"]),
		make_candidate(platform, "deno", "deno", ["--version"], () => ["install"]),
		make_candidate(platform, "bun", "bun", ["--version"], () => [
			"install",
			"--production",
			"--ignore-scripts",
		]),
		make_candidate(
			platform,
			"corepack pnpm",
			"corepack",
			["pnpm", "--version"],
			() => ["pnpm", "install", "--prod", "--ignore-scripts", "--no-frozen-lockfile"],
			{
				COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
			},
		),
		make_candidate(platform, "pnpm", "pnpm", ["--version"], () => [
			"install",
			"--prod",
			"--ignore-scripts",
			"--no-frozen-lockfile",
		]),
		make_candidate(
			platform,
			"corepack yarn",
			"corepack",
			["yarn", "--version"],
			(version_output) => ["yarn", ...make_yarn_install_args(version_output)],
			{
				COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
				YARN_ENABLE_SCRIPTS: "false",
				YARN_NODE_LINKER: "node-modules",
			},
		),
		make_candidate(platform, "yarn", "yarn", ["--version"], make_yarn_install_args, {
			YARN_ENABLE_SCRIPTS: "false",
			YARN_NODE_LINKER: "node-modules",
		}),
		make_candidate(platform, "npm", "npm", ["--version"], () => [
			"install",
			"--omit=dev",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--package-lock=false",
		]),
	];
}

/**
 * Installs dependencies using the first available package manager that passes
 * the supplied install verifier.
 *
 * @example
 * ```ts
 * await run_package_manager_install({
 *   install_root,
 *   reporter: output_channel,
 *   verify_install: async () => verify_language_server_install(install_root, version),
 * });
 * ```
 *
 * @since 3.4.9
 * @param options - Install root, command runner, progress reporter, and final
 *   verification callback for the language-server files.
 * @returns The name of the package manager that completed a verified install.
 */
export async function run_package_manager_install(
	options: PackageManagerInstallOptions,
): Promise<string> {
	const candidates = options.candidates ?? make_package_manager_candidates();
	const run_command = options.run_command ?? run_command_invocation;
	const clean_install_root = options.clean_install_root ?? clean_package_manager_install_root;
	const attempts: PackageManagerAttempt[] = [];

	/**
	 * Probe every supported package manager until one can install and verify
	 * the cache-local language-server package.
	 */
	for (const candidate of candidates) {
		const probe_result = await run_package_manager_step(() => run_command(candidate.probe));

		if (!probe_result.ok) {
			attempts.push({
				name: candidate.name,
				phase: "probe",
				message: probe_result.message,
			});
			continue;
		}

		const install = candidate.install(probe_result.result.stdout);

		options.reporter?.appendLine(`Trying package manager: ${candidate.name}.`);
		await clean_install_root(options.install_root);

		const install_result = await run_package_manager_step(() =>
			run_command(install, options.install_root),
		);

		if (!install_result.ok) {
			attempts.push({
				name: candidate.name,
				phase: "install",
				message: install_result.message,
			});
			continue;
		}

		const verify_result = await run_package_manager_step(options.verify_install);

		if (!verify_result.ok) {
			attempts.push({
				name: candidate.name,
				phase: "verify",
				message: verify_result.message,
			});
			continue;
		}

		return candidate.name;
	}

	throw new Error(format_package_manager_install_failure(attempts));
}

async function run_command_invocation(
	invocation: CommandInvocation,
	cwd?: string,
): Promise<PackageManagerCommandResult> {
	const result = await exec_file(invocation.command, invocation.args, {
		cwd,
		env: {
			...process.env,
			...invocation.env,
		},
		windowsHide: true,
		maxBuffer: 10 * 1024 * 1024,
	});

	return {
		stdout: String(result.stdout ?? ""),
		stderr: String(result.stderr ?? ""),
	};
}

function make_candidate(
	platform: NodeJS.Platform,
	name: string,
	command: string,
	probe_args: string[],
	install_args: (version_output: string) => string[],
	env?: NodeJS.ProcessEnv,
): PackageManagerCandidate {
	return {
		name,
		probe: make_platform_invocation(platform, {
			command,
			args: probe_args,
			env,
		}),
		install: (version_output) =>
			make_platform_invocation(platform, {
				command,
				args: install_args(version_output),
				env,
			}),
	};
}

function make_platform_invocation(
	platform: NodeJS.Platform,
	invocation: CommandInvocation,
): CommandInvocation {
	if (platform !== "win32") {
		return invocation;
	}

	return {
		command: "cmd.exe",
		args: ["/d", "/s", "/c", invocation.command, ...invocation.args],
		env: invocation.env,
	};
}

function make_yarn_install_args(version_output: string): string[] {
	const version = version_output.trim();

	if (version.startsWith("1.")) {
		return ["install", "--production=true", "--ignore-scripts", "--no-lockfile"];
	}

	return ["install"];
}

async function clean_package_manager_install_root(install_root: string): Promise<void> {
	await Promise.all(
		INSTALL_ARTIFACTS.map((artifact) =>
			rm(join(install_root, artifact), {
				recursive: true,
				force: true,
			}),
		),
	);
}

async function run_package_manager_step<T>(
	step: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; message: string }> {
	try {
		const result = await step();

		return { ok: true, result };
	} catch (error) {
		return {
			ok: false,
			message: format_command_error(error),
		};
	}
}

function format_package_manager_install_failure(attempts: PackageManagerAttempt[]): string {
	const attempt_lines = attempts.map(
		(attempt) => `- ${attempt.name} ${attempt.phase}: ${attempt.message}`,
	);

	return [
		"Unable to install svelte-effect-runtime-language-server with any available package manager.",
		...attempt_lines,
	].join("\n");
}

function format_command_error(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const stdout = get_error_output(error, "stdout");
	const stderr = get_error_output(error, "stderr");
	const output = [stdout, stderr].filter(Boolean).join("\n").trim();

	if (!output) {
		return message;
	}

	return `${message}\n${output}`;
}

function get_error_output(error: unknown, key: "stderr" | "stdout"): string | undefined {
	if (typeof error !== "object" || error === null || !(key in error)) {
		return undefined;
	}

	const value = (error as Record<string, unknown>)[key];

	if (value === undefined || value === null) {
		return undefined;
	}

	return String(value).trim();
}
