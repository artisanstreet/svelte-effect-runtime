import {
  CONFIG_CLIENT_MODE,
  CONFIG_ENABLED,
  CONFIG_ROOT,
  CONFIG_SERVER_PATH,
} from "./constants.ts";
import type { ClientMode } from "./types.ts";

import * as vscode from "vscode";

/**
 * Checks whether a configuration change affects language-server state.
 *
 * @example
 * ```ts
 * if (affects_language_server_configuration(event)) sync();
 * ```
 *
 * @since 2.0.0
 * @param event - VS Code configuration-change event.
 * @returns Whether the extension should resync language-server state.
 */
export function affects_language_server_configuration(
  event: vscode.ConfigurationChangeEvent,
): boolean {
  return event.affectsConfiguration(`${CONFIG_ROOT}.${CONFIG_ENABLED}`) ||
    event.affectsConfiguration(`${CONFIG_ROOT}.${CONFIG_CLIENT_MODE}`) ||
    event.affectsConfiguration(`${CONFIG_ROOT}.${CONFIG_SERVER_PATH}`);
}

/**
 * Reads whether the extension should run a language server.
 *
 * @example
 * ```ts
 * if (!is_language_server_enabled()) await stop_language_server();
 * ```
 *
 * @since 2.0.0
 * @returns Whether language-server support is enabled.
 */
export function is_language_server_enabled(): boolean {
  return vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .get(CONFIG_ENABLED, true);
}

/**
 * Persists the language-server enabled setting.
 *
 * @example
 * ```ts
 * await set_language_server_enabled(false);
 * ```
 *
 * @since 2.0.0
 * @param enabled - Desired enabled state to write globally.
 * @returns A promise that resolves once the setting has been updated.
 */
export async function set_language_server_enabled(
  enabled: boolean,
): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .update(
      CONFIG_ENABLED,
      enabled,
      vscode.ConfigurationTarget.Global,
    );
}

/**
 * Reads the configured client strategy.
 *
 * @example
 * ```ts
 * const mode = get_client_mode();
 * ```
 *
 * @since 2.0.0
 * @returns The configured client mode, defaulting to `auto`.
 */
export function get_client_mode(): ClientMode {
  return vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .get<ClientMode>(CONFIG_CLIENT_MODE, "auto");
}
