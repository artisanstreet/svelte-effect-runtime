import {
  LEGACY_STATE_MANAGED_PATH,
  LEGACY_STATE_PREVIOUS_PATH,
  LEGACY_TARGET_KEY,
} from "./constants.ts";
import { paths_equal } from "./paths.ts";

import path from "node:path";

import * as vscode from "vscode";

/**
 * Records legacy managed Svelte-extension configuration from older releases.
 *
 * @example
 * ```ts
 * await migrate_legacy_svelte_configuration(context);
 * ```
 *
 * @since 2.0.0
 * @param context - VS Code extension context used for global state.
 * @returns A promise that resolves once migration state has been updated.
 */
export async function migrate_legacy_svelte_configuration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const svelte_config = vscode.workspace.getConfiguration("svelte");
  const current_path = svelte_config.get<string | undefined>(
    LEGACY_TARGET_KEY,
  );
  const legacy_server_path = context.asAbsolutePath(
    path.join(".dist", "server.js"),
  );
  const managed_path = context.globalState.get<string | undefined>(
    LEGACY_STATE_MANAGED_PATH,
  );

  if (paths_equal(current_path, legacy_server_path) && !managed_path) {
    await context.globalState.update(
      LEGACY_STATE_MANAGED_PATH,
      legacy_server_path,
    );
  }
}

/**
 * Points the official Svelte extension at this extension's language server.
 *
 * @example
 * ```ts
 * const configured = await configure_svelte_extension_language_server(context, server_path, { force: false });
 * ```
 *
 * @since 2.0.0
 * @param context - VS Code extension context used for global state.
 * @param server_path - Absolute path to the SER language-server script.
 * @param options - Configuration behavior for user-owned settings.
 * @returns Whether the Svelte extension configuration was updated.
 */
export async function configure_svelte_extension_language_server(
  context: vscode.ExtensionContext,
  server_path: string,
  options: { force: boolean },
): Promise<boolean> {
  const svelte_config = vscode.workspace.getConfiguration("svelte");
  const current_path = svelte_config.get<string | undefined>(
    LEGACY_TARGET_KEY,
  );
  const managed_path = context.globalState.get<string | undefined>(
    LEGACY_STATE_MANAGED_PATH,
  );
  const can_configure = !current_path ||
    paths_equal(current_path, managed_path) ||
    paths_equal(current_path, server_path);

  if (!options.force && !can_configure) {
    return false;
  }

  if (
    current_path &&
    !paths_equal(current_path, server_path) &&
    !paths_equal(current_path, managed_path)
  ) {
    await context.globalState.update(
      LEGACY_STATE_PREVIOUS_PATH,
      current_path,
    );
  }

  await svelte_config.update(
    LEGACY_TARGET_KEY,
    server_path,
    vscode.ConfigurationTarget.Global,
  );
  await context.globalState.update(LEGACY_STATE_MANAGED_PATH, server_path);

  return true;
}

/**
 * Restores the user's previous official Svelte extension language-server path.
 *
 * @example
 * ```ts
 * await restore_svelte_extension_configuration(context);
 * ```
 *
 * @since 2.0.0
 * @param context - VS Code extension context used for global state.
 * @returns A promise that resolves once managed settings have been restored.
 */
export async function restore_svelte_extension_configuration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const svelte_config = vscode.workspace.getConfiguration("svelte");
  const current_path = svelte_config.get<string | undefined>(
    LEGACY_TARGET_KEY,
  );
  const managed_path = context.globalState.get<string | undefined>(
    LEGACY_STATE_MANAGED_PATH,
  );
  const previous_path = context.globalState.get<string | undefined>(
    LEGACY_STATE_PREVIOUS_PATH,
  );

  if (paths_equal(current_path, managed_path)) {
    await svelte_config.update(
      LEGACY_TARGET_KEY,
      previous_path ?? undefined,
      vscode.ConfigurationTarget.Global,
    );
  }

  await context.globalState.update(LEGACY_STATE_MANAGED_PATH, undefined);
  await context.globalState.update(LEGACY_STATE_PREVIOUS_PATH, undefined);
}
