import { CONFIG_ROOT, CONFIG_SERVER_PATH, LANGUAGE_SERVER_PACKAGE_NAME } from "./constants.ts";
import {
	LANGUAGE_SERVER_PACKAGE_VERSION,
	make_language_server_install_manifest,
} from "./language-server-package.ts";
import {
	resolve_configured_server_path,
	type ScopedServerPathConfiguration,
} from "./server-path-policy.ts";

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import process from "node:process";

import * as vscode from "vscode";

const exec_file = promisify(execFile);
const LANGUAGE_SERVER_CACHE_DIR = "language-server";
const LANGUAGE_SERVER_SCRIPT_PATH = [
	"node_modules",
	LANGUAGE_SERVER_PACKAGE_NAME,
	".dist",
	"server.cjs",
];
const LANGUAGE_SERVER_RUNTIME_PATH = [
	"node_modules",
	LANGUAGE_SERVER_PACKAGE_NAME,
	"runtime",
	"package.json",
];

let install_task: Promise<string> | undefined;

/**
 * Resolves the language-server script path from settings or a pnpm install.
 *
 * @example
 * ```ts
 * const server_path = await get_server_path(context, output_channel);
 * ```
 *
 * @since 2.0.0
 * @param context - VS Code extension context used to resolve global storage.
 * @param output_channel - Output channel used to report install progress.
 * @returns A promise that resolves to the server script that should execute.
 */
export async function get_server_path(
	context: vscode.ExtensionContext,
	output_channel: vscode.OutputChannel,
): Promise<string> {
	const configured_path = get_configured_server_path(output_channel);

	if (configured_path) {
		return configured_path;
	}

	install_task ??= install_language_server(context, output_channel).catch((error) => {
		install_task = undefined;

		throw error;
	});

	return await install_task;
}

/**
 * Reads the optional user-configured language-server path.
 *
 * @example
 * ```ts
 * const configured = get_configured_server_path();
 * ```
 *
 * @since 2.0.0
 * @param output_channel - Optional output channel used to report ignored
 *   unsafe configuration.
 * @returns The configured path, or undefined when the setting is empty.
 */
export function get_configured_server_path(
	output_channel?: vscode.OutputChannel,
): string | undefined {
	const result = resolve_configured_server_path(read_scoped_server_path_configuration());

	if (result.ignored_workspace_path) {
		output_channel?.appendLine(
			"Ignoring workspace svelte-effect-runtime.languageServer.path because executable paths must be configured in user or machine settings.",
		);
	}

	if (result.invalid_global_path) {
		output_channel?.appendLine(
			"Ignoring svelte-effect-runtime.languageServer.path because it is not an absolute local filesystem path.",
		);
	}

	return result.path;
}

function read_scoped_server_path_configuration(): ScopedServerPathConfiguration {
	const inspection = vscode.workspace.getConfiguration(CONFIG_ROOT).inspect(CONFIG_SERVER_PATH);

	return {
		global_path: inspection?.globalValue,
		workspace_path: inspection?.workspaceValue,
		workspace_folder_path: inspection?.workspaceFolderValue,
		workspace_language_path: inspection?.workspaceLanguageValue,
		workspace_folder_language_path: inspection?.workspaceFolderLanguageValue,
	};
}

async function install_language_server(
	context: vscode.ExtensionContext,
	output_channel: vscode.OutputChannel,
): Promise<string> {
	const install_root = join(context.globalStorageUri.fsPath, LANGUAGE_SERVER_CACHE_DIR);
	const installed_version = await read_installed_package_version(install_root);
	const target_version = LANGUAGE_SERVER_PACKAGE_VERSION;
	const install_manifest = make_language_server_install_manifest();

	await mkdir(install_root, { recursive: true });

	if (installed_version !== target_version) {
		output_channel.appendLine(
			`Installing ${LANGUAGE_SERVER_PACKAGE_NAME}@${target_version} with corepack pnpm.`,
		);

		await writeFile(
			join(install_root, "package.json"),
			`${JSON.stringify(install_manifest, null, 2)}\n`,
		);
		await run_pnpm_install(install_root);
	}

	return await verify_language_server_install(install_root, target_version);
}

async function read_installed_package_version(install_root: string): Promise<string | undefined> {
	const package_json_path = join(
		install_root,
		"node_modules",
		LANGUAGE_SERVER_PACKAGE_NAME,
		"package.json",
	);

	try {
		const package_json = JSON.parse(await readFile(package_json_path, "utf8"));

		return typeof package_json.version === "string" ? package_json.version : undefined;
	} catch {
		return undefined;
	}
}

async function verify_language_server_install(
	install_root: string,
	target_version: string,
): Promise<string> {
	const script_path = join(install_root, ...LANGUAGE_SERVER_SCRIPT_PATH);
	const runtime_path = join(install_root, ...LANGUAGE_SERVER_RUNTIME_PATH);
	const installed_version = await read_installed_package_version(install_root);

	await access(script_path);
	await access(runtime_path);

	if (installed_version !== target_version) {
		throw new Error(
			`Installed ${LANGUAGE_SERVER_PACKAGE_NAME}@${
				installed_version ?? "unknown"
			} does not match required ${target_version}.`,
		);
	}

	return script_path;
}

async function run_pnpm_install(install_root: string): Promise<void> {
	await run_corepack_pnpm(
		["install", "--prod", "--ignore-scripts", "--no-frozen-lockfile"],
		install_root,
	);
}

async function run_corepack_pnpm(args: string[], cwd?: string) {
	const invocation = corepack_pnpm_invocation(args);

	return await exec_file(invocation.command, invocation.args, {
		cwd,
		env: {
			...process.env,
			COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
		},
		windowsHide: true,
		maxBuffer: 10 * 1024 * 1024,
	});
}

function corepack_pnpm_invocation(args: string[]) {
	if (process.platform === "win32") {
		return {
			command: "cmd.exe",
			args: ["/d", "/s", "/c", "corepack", "pnpm", ...args],
		};
	}

	return {
		command: "corepack",
		args: ["pnpm", ...args],
	};
}
