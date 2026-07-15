import { mkdir, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ServerOutputOptions = {
	readonly arguments_: readonly string[];
	readonly command: string;
	readonly cwd: string;
	readonly evidence_dir: string;
};

export async function record_server_output(options: ServerOutputOptions): Promise<number> {
	const stdout_path = join(options.evidence_dir, "stdout.log");
	const stderr_path = join(options.evidence_dir, "stderr.log");
	const metadata_path = join(options.evidence_dir, "process.json");

	await mkdir(options.evidence_dir, { recursive: true });

	const stdout = createWriteStream(stdout_path, { flags: "w" });
	const stderr = createWriteStream(stderr_path, { flags: "w" });
	const child = spawn(options.command, options.arguments_, {
		cwd: options.cwd,
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	const started_at = new Date().toISOString();
	const child_exit = new Promise<number>((resolve_exit, reject_exit) => {
		child.once("error", reject_exit);
		child.once("exit", (code) => resolve_exit(code ?? 1));
	});
	const initial_metadata = {
		arguments: options.arguments_,
		child_pid: child.pid ?? null,
		command: options.command,
		cwd: options.cwd,
		exit_code: null,
		started_at,
	};

	child.stdout.on("data", (chunk: Buffer) => {
		stdout.write(chunk);
		process.stdout.write(chunk);
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr.write(chunk);
		process.stderr.write(chunk);
	});

	const forward_sigint = () => child.kill("SIGINT");
	const forward_sigterm = () => child.kill("SIGTERM");

	process.once("SIGINT", forward_sigint);
	process.once("SIGTERM", forward_sigterm);

	try {
		await writeFile(metadata_path, `${JSON.stringify(initial_metadata, null, "\t")}\n`);

		const exit_code = await child_exit;
		const metadata = {
			...initial_metadata,
			exit_code,
			finished_at: new Date().toISOString(),
		};

		await writeFile(metadata_path, `${JSON.stringify(metadata, null, "\t")}\n`);

		return exit_code;
	} finally {
		process.removeListener("SIGINT", forward_sigint);
		process.removeListener("SIGTERM", forward_sigterm);
		stdout.end();
		stderr.end();
		await Promise.all([finished(stdout), finished(stderr)]);
	}
}

function parse_options(arguments_: readonly string[]): ServerOutputOptions {
	const separator = arguments_.indexOf("--");
	const evidence_index = arguments_.indexOf("--evidence-dir");
	const evidence_dir = evidence_index === -1 ? undefined : arguments_[evidence_index + 1];
	const command = separator === -1 ? undefined : arguments_[separator + 1];
	const command_arguments = separator === -1 ? [] : arguments_.slice(separator + 2);

	if (!evidence_dir || !command) {
		throw new Error(
			"Usage: record-server-output.ts --evidence-dir <directory> -- <command> [...arguments]",
		);
	}

	return {
		arguments_: command_arguments,
		command,
		cwd: process.cwd(),
		evidence_dir: resolve(evidence_dir),
	};
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;

if (entrypoint === resolve(fileURLToPath(import.meta.url))) {
	process.exitCode = await record_server_output(parse_options(process.argv.slice(2)));
}
