import { CONFIG_ROOT, CONFIG_SERVER_PATH } from "./constants.ts";
import path from "node:path";

import * as vscode from "vscode";

/**
 * Resolves the language-server script path from settings or the bundled asset.
 *
 * @example
 * ```ts
 * const server_path = get_server_path(context);
 * ```
 *
 * @since 2.0.0
 * @param context - VS Code extension context used to resolve bundled files.
 * @returns Absolute path to the server script that should be executed.
 */
export function get_server_path(context: vscode.ExtensionContext): string {
  return get_configured_server_path() ??
    context.asAbsolutePath(path.join(".dist", "server.cjs"));
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
 * @returns The configured path, or undefined when the setting is empty.
 */
export function get_configured_server_path(): string | undefined {
  const configured_path = vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .get(CONFIG_SERVER_PATH, "")
    .trim();

  return configured_path.length === 0 ? undefined : configured_path;
}
