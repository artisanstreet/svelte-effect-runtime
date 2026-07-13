import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

export type CommandOutput = {
	stdout: string;
	stderr: string;
};

export type RunCommandOptions = {
	inherit?: boolean;
};

export const RepoRoot = Effect.gen(function* () {
	const path = yield* Path.Path;
	const module_path = yield* path.fromFileUrl(new URL(import.meta.url));

	return path.resolve(path.dirname(module_path), "..");
});

export function ResetDir(target_path: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		yield* file_system.remove(target_path, { force: true, recursive: true });
		yield* file_system.makeDirectory(target_path, { recursive: true });
	});
}

export function RemovePath(target_path: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		yield* file_system.remove(target_path, { force: true, recursive: true });
	});
}

export function CommandName(command: string) {
	return Effect.gen(function* () {
		const platform = yield* Effect.sync(() => process.platform);

		return platform === "win32" ? `${command}.cmd` : command;
	});
}

export function MakeTempDirScoped(prefix: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		return yield* file_system.makeTempDirectoryScoped({ prefix });
	});
}

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
