import { Context, Data, Deferred, Effect, FileSystem, Layer, Path, Result } from "effect";
import { type ChildProcess, spawn } from "node:child_process";

import process from "node:process";

const install_artifacts = [
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
const max_command_output_bytes = 10 * 1024 * 1024;

/**
 * Command line invocation for a package manager probe or install step.
 *
 * @example
 * ```ts
 * const invocation: CommandInvocation = {
 * 	command: "pnpm",
 * 	args: ["install", "--prod"],
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
	/** Environment overrides applied on top of the extension host environment. */
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
 * Effectful command runner used by the package-manager installer.
 *
 * @example
 * ```ts
 * const runner: PackageManagerCommandRunner = () =>
 * 	Effect.succeed({ stdout: "1.0.0", stderr: "" });
 * ```
 *
 * @since 4.0.1
 */
export type PackageManagerCommandRunner = (
	invocation: CommandInvocation,
	cwd?: string,
) => Effect.Effect<PackageManagerCommandResult, unknown>;

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
 * 	append_line: (message) => Effect.sync(() => console.log(message)),
 * };
 * ```
 *
 * @since 4.0.1
 */
export interface PackageManagerInstallReporter {
	/** Records one installer progress line. */
	append_line(message: string): Effect.Effect<void>;
}

/**
 * Options for the package-manager fallback installer.
 *
 * @example
 * ```ts
 * const program = RunPackageManagerInstall({
 * 	install_root,
 * 	verify_install: Effect.void,
 * });
 * ```
 *
 * @since 4.0.1
 */
export interface PackageManagerInstallOptions<R = never> {
	/** Directory containing the generated package.json to install. */
	install_root: string;
	/** Optional progress reporter. */
	reporter?: PackageManagerInstallReporter;
	/** Candidate package managers to try, primarily used by tests. */
	candidates?: PackageManagerCandidate[];
	/** Verifies that a completed install produced the expected server files. */
	verify_install: Effect.Effect<void, unknown, R>;
}

interface PackageManagerAttempt {
	name: string;
	phase: "install" | "probe" | "verify";
	message: string;
}

class PackageManagerCommandError extends Data.TaggedError("PackageManagerCommandError")<{
	readonly cause: unknown;
	readonly stderr: string;
	readonly stdout: string;
}> {}

class PackageManagerInstallError extends Data.TaggedError("PackageManagerInstallError")<{
	readonly message: string;
}> {}

/**
 * Executes package-manager commands while preserving the extension host's
 * Windows, output-limit, environment, and cancellation behavior.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 * 	const command = yield* PackageManagerCommand;
 * 	return yield* command.run({ command: "pnpm", args: ["--version"] });
 * });
 * ```
 *
 * @since 4.0.1
 */
export class PackageManagerCommand extends Context.Service<
	PackageManagerCommand,
	{
		readonly run: PackageManagerCommandRunner;
	}
>()("svelte-effect-runtime-vsix/PackageManagerCommand") {}

/**
 * Removes package-manager artifacts before each fallback attempt.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 * 	const files = yield* PackageManagerInstallFiles;
 * 	yield* files.clean("/tmp/ser-language-server");
 * });
 * ```
 *
 * @since 4.0.1
 */
export class PackageManagerInstallFiles extends Context.Service<
	PackageManagerInstallFiles,
	{
		readonly clean: (install_root: string) => Effect.Effect<void, unknown>;
	}
>()("svelte-effect-runtime-vsix/PackageManagerInstallFiles") {}

/**
 * Live command runner backed by a hidden, lifecycle-managed Node child process.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 * 	const command = yield* PackageManagerCommand;
 * 	return yield* command.run({ command: "pnpm", args: ["--version"] });
 * }).pipe(Effect.provide(PackageManagerCommandLive));
 * ```
 *
 * @since 4.0.1
 */
export const PackageManagerCommandLive = Layer.succeed(PackageManagerCommand, {
	run: RunCommandInvocation,
});

/**
 * Live package-manager cleanup backed by Effect's filesystem and path services.
 *
 * @example
 * ```ts
 * const layer = PackageManagerInstallFilesLive;
 * ```
 *
 * @since 4.0.1
 */
export const PackageManagerInstallFilesLive = Layer.effect(
	PackageManagerInstallFiles,
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;

		const Clean = (install_root: string) =>
			Effect.gen(function* () {
				yield* Effect.forEach(
					install_artifacts,
					(artifact) =>
						file_system.remove(path_service.join(install_root, artifact), {
							recursive: true,
							force: true,
						}),
					{ concurrency: "unbounded", discard: true },
				);
			});

		return { clean: Clean };
	}),
);

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
 * const program = RunPackageManagerInstall({
 * 	install_root,
 * 	verify_install: VerifyLanguageServerInstall(install_root, version),
 * });
 * ```
 *
 * @since 4.0.1
 * @param options - Install root, progress reporter, candidates, and final
 *   verification Effect for the language-server files.
 * @returns An Effect that yields the name of the package manager that completed
 *   a verified install.
 */
export function RunPackageManagerInstall<R>(
	options: PackageManagerInstallOptions<R>,
): Effect.Effect<
	string,
	PackageManagerInstallError,
	PackageManagerCommand | PackageManagerInstallFiles | R
> {
	return Effect.gen(function* () {
		const command = yield* PackageManagerCommand;
		const files = yield* PackageManagerInstallFiles;
		const candidates = options.candidates ?? make_package_manager_candidates();
		const attempts: PackageManagerAttempt[] = [];

		for (const candidate of candidates) {
			const probe_result = yield* Effect.result(command.run(candidate.probe));

			if (Result.isFailure(probe_result)) {
				attempts.push({
					name: candidate.name,
					phase: "probe",
					message: format_command_error(probe_result.failure),
				});
				continue;
			}

			const install = candidate.install(probe_result.success.stdout);

			if (options.reporter) {
				yield* options.reporter.append_line(`Trying package manager: ${candidate.name}.`);
			}

			yield* files.clean(options.install_root).pipe(
				Effect.mapError(
					(error) =>
						new PackageManagerInstallError({
							message: format_command_error(error),
						}),
				),
			);

			const install_result = yield* Effect.result(command.run(install, options.install_root));

			if (Result.isFailure(install_result)) {
				attempts.push({
					name: candidate.name,
					phase: "install",
					message: format_command_error(install_result.failure),
				});
				continue;
			}

			const verify_result = yield* Effect.result(options.verify_install);

			if (Result.isFailure(verify_result)) {
				attempts.push({
					name: candidate.name,
					phase: "verify",
					message: format_command_error(verify_result.failure),
				});
				continue;
			}

			return candidate.name;
		}

		return yield* new PackageManagerInstallError({
			message: format_package_manager_install_failure(attempts),
		});
	});
}

function RunCommandInvocation(
	invocation: CommandInvocation,
	cwd?: string,
): Effect.Effect<PackageManagerCommandResult, PackageManagerCommandError> {
	return Effect.acquireUseRelease(
		SpawnCommandInvocation(invocation, cwd),
		(running_command) => running_command.completion,
		(running_command) =>
			TerminateProcessTree(running_command.child, running_command.AwaitClose),
	);
}

interface RunningCommand {
	readonly AwaitClose: Effect.Effect<void>;
	readonly child: ChildProcess;
	readonly completion: Effect.Effect<PackageManagerCommandResult, PackageManagerCommandError>;
}

function SpawnCommandInvocation(
	invocation: CommandInvocation,
	cwd?: string,
): Effect.Effect<RunningCommand, PackageManagerCommandError> {
	return Effect.try({
		try: () => {
			const completion = Deferred.makeUnsafe<
				PackageManagerCommandResult,
				PackageManagerCommandError
			>();
			const process_closed = Deferred.makeUnsafe<void>();
			const stdout_chunks: Buffer[] = [];
			const stderr_chunks: Buffer[] = [];
			let output_bytes = 0;
			let output_exceeded = false;
			const child = spawn(invocation.command, invocation.args, {
				...(cwd === undefined ? {} : { cwd }),
				detached: process.platform !== "win32",
				env: {
					...process.env,
					...invocation.env,
				},
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			const complete_with_output_error = () =>
				Deferred.doneUnsafe(
					completion,
					Effect.fail(
						new PackageManagerCommandError({
							cause: new Error(
								`Command output exceeded ${max_command_output_bytes} bytes.`,
							),
							stderr: Buffer.concat(stderr_chunks).toString(),
							stdout: Buffer.concat(stdout_chunks).toString(),
						}),
					),
				);
			const record_output = (chunks: Buffer[], chunk: Buffer) => {
				if (output_exceeded) {
					return;
				}

				output_bytes += chunk.byteLength;

				if (output_bytes > max_command_output_bytes) {
					output_exceeded = true;
					complete_with_output_error();

					return;
				}

				chunks.push(chunk);
			};

			child.stdout?.on("data", (chunk: Buffer) => record_output(stdout_chunks, chunk));
			child.stderr?.on("data", (chunk: Buffer) => record_output(stderr_chunks, chunk));
			child.once("error", (error) => {
				Deferred.doneUnsafe(
					completion,
					Effect.fail(
						new PackageManagerCommandError({
							cause: error,
							stderr: Buffer.concat(stderr_chunks).toString(),
							stdout: Buffer.concat(stdout_chunks).toString(),
						}),
					),
				);
			});
			child.once("close", (code, signal) => {
				const result = {
					stderr: Buffer.concat(stderr_chunks).toString(),
					stdout: Buffer.concat(stdout_chunks).toString(),
				};

				Deferred.doneUnsafe(process_closed, Effect.void);

				if (code === 0) {
					Deferred.doneUnsafe(completion, Effect.succeed(result));

					return;
				}

				Deferred.doneUnsafe(
					completion,
					Effect.fail(
						new PackageManagerCommandError({
							cause: new Error(
								`Command exited with ${code ?? `signal ${signal ?? "unknown"}`}.`,
							),
							...result,
						}),
					),
				);
			});

			return {
				AwaitClose: Deferred.await(process_closed),
				child,
				completion: Deferred.await(completion),
			};
		},
		catch: (cause) =>
			new PackageManagerCommandError({
				cause,
				stderr: "",
				stdout: "",
			}),
	});
}

function TerminateProcessTree(
	child: ChildProcess,
	AwaitClose: Effect.Effect<void>,
): Effect.Effect<void> {
	return Effect.gen(function* () {
		if (child.exitCode === null && child.signalCode === null) {
			if (process.platform === "win32") {
				yield* TerminateWindowsProcessTree(child);
			} else {
				yield* TerminatePosixProcessTree(child);
			}
		}

		yield* Effect.timeoutOrElse(AwaitClose, {
			duration: "5 seconds",
			orElse: () => Effect.void,
		});
	});
}

function TerminateWindowsProcessTree(child: ChildProcess): Effect.Effect<void> {
	return Effect.gen(function* () {
		const pid = child.pid;

		if (pid === undefined) {
			yield* Effect.sync(() => child.kill("SIGKILL"));

			return;
		}

		const tree_killed = yield* Effect.callback<boolean>((resume) => {
			const killer = spawn("taskkill.exe", ["/pid", String(pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});

			killer.once("error", () => resume(Effect.succeed(false)));
			killer.once("close", (code) => resume(Effect.succeed(code === 0)));

			return Effect.sync(() => killer.kill());
		});

		if (!tree_killed) {
			yield* Effect.sync(() => child.kill("SIGKILL"));
		}
	});
}

function TerminatePosixProcessTree(child: ChildProcess): Effect.Effect<void> {
	return Effect.gen(function* () {
		const pid = child.pid;

		if (pid === undefined) {
			yield* Effect.sync(() => child.kill("SIGKILL"));

			return;
		}

		const group_kill = yield* Effect.result(Effect.try(() => process.kill(-pid, "SIGKILL")));

		if (Result.isFailure(group_kill)) {
			yield* Effect.sync(() => child.kill("SIGKILL"));
		}
	});
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
			...(env === undefined ? {} : { env }),
		}),
		install: (version_output) =>
			make_platform_invocation(platform, {
				command,
				args: install_args(version_output),
				...(env === undefined ? {} : { env }),
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
		...(invocation.env === undefined ? {} : { env: invocation.env }),
	};
}

function make_yarn_install_args(version_output: string): string[] {
	const version = version_output.trim();

	if (version.startsWith("1.")) {
		return ["install", "--production=true", "--ignore-scripts", "--no-lockfile"];
	}

	return ["install"];
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
	if (error instanceof PackageManagerCommandError) {
		const message = error.cause instanceof Error ? error.cause.message : String(error.cause);
		const output = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();

		return output ? `${message}\n${output}` : message;
	}

	if (error instanceof PackageManagerInstallError) {
		return error.message;
	}

	return error instanceof Error ? error.message : String(error);
}
