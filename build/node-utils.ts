import {
	copyFile,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { tmpdir } from "node:os";

import process from "node:process";

export {
	copyFile,
	cp,
	dirname,
	join,
	mkdir,
	readdir,
	readFile,
	relative,
	resolve,
	stat,
	writeFile,
};

export const repo_root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type CommandOutput = {
	stdout: string;
	stderr: string;
};

export type RunCommandOptions = {
	inherit?: boolean;
};

export async function reset_dir(path: string): Promise<void> {
	await remove_path(path);
	await mkdir(path, { recursive: true });
}

export async function remove_path(path: string): Promise<void> {
	await rm(path, { force: true, recursive: true });
}

export async function path_exists(path: string): Promise<boolean> {
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

export function is_not_found_error(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function command_name(command: string): string {
	return process.platform === "win32" ? `${command}.cmd` : command;
}

export async function make_temp_dir(prefix: string): Promise<string> {
	return await mkdtemp(join(tmpdir(), prefix));
}

export async function get_available_port(): Promise<number> {
	return await new Promise((resolve_port, reject_port) => {
		const server = createServer();

		server.once("error", reject_port);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();

			if (!address || typeof address === "string") {
				server.close();
				reject_port(new Error("Could not reserve a local port."));

				return;
			}

			server.close(() => resolve_port(address.port));
		});
	});
}

export async function run_command(
	command: string,
	args: string[],
	cwd: string,
	options: RunCommandOptions = {},
): Promise<CommandOutput> {
	return await new Promise((resolve_command, reject_command) => {
		const stdout_chunks: Buffer[] = [];
		const stderr_chunks: Buffer[] = [];
		const spawn_config = resolve_spawn_config(command, args);
		const child = spawn(spawn_config.command, spawn_config.args, {
			cwd,
			env: process.env,
			stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
		});

		if (!options.inherit) {
			child.stdout?.on("data", (chunk: Buffer) => stdout_chunks.push(chunk));
			child.stderr?.on("data", (chunk: Buffer) => stderr_chunks.push(chunk));
		}

		child.once("error", reject_command);
		child.once("close", (code) => {
			const stdout = Buffer.concat(stdout_chunks).toString();
			const stderr = Buffer.concat(stderr_chunks).toString();

			if (code === 0) {
				resolve_command({ stdout, stderr });

				return;
			}

			reject_command(
				new Error(
					[`${command} ${args.join(" ")} failed`, stdout.trim(), stderr.trim()]
						.filter(Boolean)
						.join("\n\n"),
				),
			);
		});
	});
}

function resolve_spawn_config(
	command: string,
	args: string[],
): { command: string; args: string[] } {
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
