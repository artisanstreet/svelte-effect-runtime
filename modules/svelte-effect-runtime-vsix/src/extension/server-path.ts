import {
  CONFIG_ROOT,
  CONFIG_SERVER_PATH,
  LANGUAGE_SERVER_PACKAGE_NAME,
} from "./constants.ts";
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
 * Resolves the language-server script path from settings or an npm install.
 *
 * @example
 * ```ts
 * const server_path = await get_server_path(context, output_channel);
 * ```
 *
 * @since 2.0.0
 * @param context - VS Code extension context used to resolve global storage.
 * @param output_channel - Output channel used to report npm install progress.
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

  install_task ??= install_language_server(context, output_channel).catch(
    (error) => {
      install_task = undefined;

      throw error;
    },
  );

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
  const result = resolve_configured_server_path(
    read_scoped_server_path_configuration(),
  );

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
  const inspection = vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .inspect(CONFIG_SERVER_PATH);

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
  const install_root = join(
    context.globalStorageUri.fsPath,
    LANGUAGE_SERVER_CACHE_DIR,
  );
  const installed_version = await read_installed_package_version(install_root);
  const latest_version = await read_latest_package_version(
    output_channel,
    installed_version,
  );

  await mkdir(install_root, { recursive: true });

  if (installed_version !== latest_version) {
    output_channel.appendLine(
      `Installing ${LANGUAGE_SERVER_PACKAGE_NAME}@${latest_version}.`,
    );

    await writeFile(
      join(install_root, "package.json"),
      `${JSON.stringify(make_install_manifest(latest_version), null, 2)}\n`,
    );
    await run_npm_install(
      install_root,
      output_channel,
      installed_version,
    );
  }

  return await verify_language_server_install(install_root);
}

async function read_latest_package_version(
  output_channel: vscode.OutputChannel,
  installed_version: string | undefined,
): Promise<string> {
  try {
    const { stdout } = await run_npm([
      "view",
      LANGUAGE_SERVER_PACKAGE_NAME,
      "version",
      "--json",
    ]);

    return parse_npm_version(stdout);
  } catch (error) {
    const message = format_error(error);

    output_channel.appendLine(
      `Failed to read latest ${LANGUAGE_SERVER_PACKAGE_NAME} version: ${message}`,
    );

    if (installed_version) {
      output_channel.appendLine(
        `Using installed ${LANGUAGE_SERVER_PACKAGE_NAME}@${installed_version}.`,
      );

      return installed_version;
    }

    throw error;
  }
}

async function read_installed_package_version(
  install_root: string,
): Promise<string | undefined> {
  const package_json_path = join(
    install_root,
    "node_modules",
    LANGUAGE_SERVER_PACKAGE_NAME,
    "package.json",
  );

  try {
    const package_json = JSON.parse(await readFile(package_json_path, "utf8"));

    return typeof package_json.version === "string"
      ? package_json.version
      : undefined;
  } catch {
    return undefined;
  }
}

async function verify_language_server_install(
  install_root: string,
): Promise<string> {
  const script_path = join(install_root, ...LANGUAGE_SERVER_SCRIPT_PATH);
  const runtime_path = join(install_root, ...LANGUAGE_SERVER_RUNTIME_PATH);

  await access(script_path);
  await access(runtime_path);

  return script_path;
}

async function run_npm_install(
  install_root: string,
  output_channel: vscode.OutputChannel,
  installed_version: string | undefined,
): Promise<void> {
  try {
    await run_npm(
      [
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      install_root,
    );
  } catch (error) {
    if (!installed_version) {
      throw error;
    }

    output_channel.appendLine(
      `Failed to update ${LANGUAGE_SERVER_PACKAGE_NAME}; using installed ${installed_version}.`,
    );
  }
}

async function run_npm(args: string[], cwd?: string) {
  const invocation = npm_invocation(args);

  return await exec_file(invocation.command, invocation.args, {
    cwd,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function make_install_manifest(version: string) {
  return {
    private: true,
    dependencies: {
      [LANGUAGE_SERVER_PACKAGE_NAME]: version,
    },
  };
}

function parse_npm_version(stdout: string): string {
  const text = stdout.trim();
  const parsed = JSON.parse(text);

  if (typeof parsed !== "string" || parsed.length === 0) {
    throw new Error(
      `Unexpected npm version response for ${LANGUAGE_SERVER_PACKAGE_NAME}: ${text}`,
    );
  }

  return parsed;
}

function npm_invocation(args: string[]) {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args],
    };
  }

  return {
    command: "npm",
    args,
  };
}

function format_error(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
