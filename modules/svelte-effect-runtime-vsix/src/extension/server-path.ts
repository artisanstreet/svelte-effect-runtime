import { CONFIG_ROOT, CONFIG_SERVER_PATH, LANGUAGE_SERVER_PACKAGE_NAME } from "./constants.ts";
import {
	LANGUAGE_SERVER_PACKAGE_VERSION,
	make_language_server_install_manifest,
} from "./language-server-package.ts";
import {
	resolve_configured_server_path,
	type ScopedServerPathConfiguration,
} from "./server-path-policy.ts";
import { run_package_manager_install } from "./package-manager-install.ts";

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as vscode from "vscode";

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
 * Resolves the language-server script path from settings or an auto install.
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
	const configured_path = await get_configured_server_path(output_channel);

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
 * const configured = await get_configured_server_path();
 * ```
 *
 * @since 2.0.0
 * @param output_channel - Optional output channel used to report ignored
 *   unsafe configuration.
 * @returns The configured path, or undefined when the setting is empty.
 */
export async function get_configured_server_path(
	output_channel?: vscode.OutputChannel,
): Promise<string | undefined> {
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

	if (!result.path) {
		return undefined;
	}

	return await resolve_existing_configured_server_path(result.path, output_channel);
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
		output_channel.appendLine(`Installing ${LANGUAGE_SERVER_PACKAGE_NAME}@${target_version}.`);

		await writeFile(
			join(install_root, "package.json"),
			`${JSON.stringify(install_manifest, null, 2)}\n`,
		);
		const package_manager = await run_package_manager_install({
			install_root,
			reporter: output_channel,
			verify_install: async () => {
				await verify_language_server_install(install_root, target_version);
			},
		});

		output_channel.appendLine(`Installed with ${package_manager}.`);
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

async function resolve_existing_configured_server_path(
	configured_path: string,
	output_channel?: vscode.OutputChannel,
): Promise<string | undefined> {
	const exists = await file_exists(configured_path);

	if (exists) {
		return configured_path;
	}

	output_channel?.appendLine(
		"Ignoring svelte-effect-runtime.languageServer.path because the configured file does not exist.",
	);

	return undefined;
}

async function file_exists(path: string): Promise<boolean> {
	try {
		await access(path);

		return true;
	} catch {
		return false;
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
