import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

/**
 * Captured output from a completed child process.
 *
 * @example
 * ```ts
 * const output: CommandOutput = { stdout: "built\n", stderr: "" };
 * ```
 *
 * @since 4.0.0
 */
export type CommandOutput = {
	stdout: string;
	stderr: string;
};

/**
 * Controls how a child process exposes its output.
 *
 * @example
 * ```ts
 * const options: RunCommandOptions = { inherit: true };
 * ```
 *
 * @since 4.0.0
 */
export type RunCommandOptions = {
	inherit?: boolean;
};

/**
 * Resolves the repository root from the build utility module URL.
 *
 * @example
 * ```ts
 * const repo_root = yield* RepoRoot;
 * ```
 *
 * @since 4.0.0
 */
export const RepoRoot = Effect.gen(function* () {
	const path = yield* Path.Path;
	const module_path = yield* path.fromFileUrl(new URL(import.meta.url));

	return path.resolve(path.dirname(module_path), "..");
});

/**
 * Removes a directory and recreates it empty.
 *
 * @example
 * ```ts
 * yield* ResetDir(".dist/example");
 * ```
 *
 * @since 4.0.0
 * @param target_path - Directory path to replace with a newly created directory.
 * @returns An Effect that completes after the empty directory is ready.
 */
export function ResetDir(target_path: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		yield* file_system.remove(target_path, { force: true, recursive: true });
		yield* file_system.makeDirectory(target_path, { recursive: true });
	});
}

/**
 * Removes a file or directory recursively when it exists.
 *
 * @example
 * ```ts
 * yield* RemovePath(".tmp/staging");
 * ```
 *
 * @since 4.0.0
 * @param target_path - File or directory path to remove.
 * @returns An Effect that completes after the path no longer exists.
 */
export function RemovePath(target_path: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		yield* file_system.remove(target_path, { force: true, recursive: true });
	});
}

/**
 * Resolves an executable name for the current operating system.
 *
 * @example
 * ```ts
 * const corepack = yield* CommandName("corepack");
 * ```
 *
 * @since 4.0.0
 * @param command - Portable executable name without a Windows command suffix.
 * @returns An Effect containing the executable name accepted by the current host.
 */
export function CommandName(command: string) {
	return Effect.gen(function* () {
		const platform = yield* Effect.sync(() => process.platform);

		return platform === "win32" ? `${command}.cmd` : command;
	});
}

/**
 * Creates a temporary directory whose lifetime is tied to the current scope.
 *
 * @example
 * ```ts
 * const staging_dir = yield* MakeTempDirScoped("ser-vsix-");
 * ```
 *
 * @since 4.0.0
 * @param prefix - Prefix used for the generated temporary directory name.
 * @returns A scoped Effect containing the temporary directory path.
 */
export function MakeTempDirScoped(prefix: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		return yield* file_system.makeTempDirectoryScoped({ prefix });
	});
}

/**
 * Runs a child process, capturing output or inheriting the current terminal.
 *
 * @example
 * ```ts
 * const output = yield* RunCommand(
 *   "corepack",
 *   ["pnpm", "pack", "--json"],
 *   process.cwd(),
 * );
 * ```
 *
 * @since 4.0.0
 * @param command - Executable name or path to launch.
 * @param args - Ordered command-line arguments passed to the executable.
 * @param cwd - Working directory used by the child process.
 * @param options - Output handling options for the child process.
 * @returns A cancellable Effect containing captured stdout and stderr.
 */
export function RunCommand(
	command: string,
	args: ReadonlyArray<string>,
	cwd: string,
	options: RunCommandOptions = {},
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const spawn_config = resolve_spawn_config(command, args);
			const child = yield* ChildProcess.make(spawn_config.command, spawn_config.args, {
				cwd,
				extendEnv: true,
				stdin: options.inherit ? "inherit" : "ignore",
				stdout: options.inherit ? "inherit" : "pipe",
				stderr: options.inherit ? "inherit" : "pipe",
			});
			const [stdout, stderr, exit_code] = yield* Effect.all(
				[
					Stream.mkString(Stream.decodeText(child.stdout)),
					Stream.mkString(Stream.decodeText(child.stderr)),
					child.exitCode,
				] as const,
				{ concurrency: "unbounded" },
			);

			if (exit_code === 0) {
				return { stdout, stderr };
			}

			const message = [`${command} ${args.join(" ")} failed`, stdout.trim(), stderr.trim()]
				.filter(Boolean)
				.join("\n\n");

			return yield* Effect.fail(new Error(message));
		}),
	);
}

function resolve_spawn_config(
	command: string,
	args: ReadonlyArray<string>,
): { command: string; args: ReadonlyArray<string> } {
	if (process.platform !== "win32" || !command.endsWith(".cmd")) {
		return { command, args };
	}

	return {
		command: process.env.ComSpec ?? "cmd.exe",
		args: ["/d", "/s", "/c", [command, ...args].map(quote_windows_arg).join(" ")],
	};
}

function quote_windows_arg(arg: string): string {
	if (!/[\s"&|<>^]/.test(arg)) {
		return arg;
	}

	return `"${arg.replaceAll('"', '\\"')}"`;
}
