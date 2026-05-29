import {
  type Executable,
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import process from "node:process";
import path from "node:path";

import * as vscode from "vscode";

const CONFIG_ROOT = "svelte-effect-runtime";
const CONFIG_ENABLED = "languageServer.enabled";
const CONFIG_CLIENT_MODE = "languageServer.client";
const CONFIG_SERVER_PATH = "languageServer.path";
const SVELTE_EXTENSION_ID = "svelte.svelte-vscode";
const LEGACY_TARGET_KEY = "language-server.ls-path";
const LEGACY_STATE_PREVIOUS_PATH = "svelteEffectRuntime.previousLsPath";
const LEGACY_STATE_MANAGED_PATH = "svelteEffectRuntime.managedLsPath";
const CLIENT_ID = "svelte-effect-runtime";
const CLIENT_NAME = "Svelte Effect Runtime";

type ClientMode = "auto" | "direct" | "svelteExtension";

let client: LanguageClient | undefined;

/**
 * Starts the VS Code extension and launches the bundled language server when
 * the user has not disabled it in settings.
 *
 * @example
 * ```ts
 * await activate(context);
 * ```
 *
 * @since 2.0.0
 * @param context - VS Code extension context used to resolve bundled files,
 *   register commands, and persist migration state.
 * @returns A promise that resolves once activation work has completed.
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output_channel = vscode.window.createOutputChannel(CLIENT_NAME);

  context.subscriptions.push(
    output_channel,
    vscode.commands.registerCommand(
      "svelte-effect-runtime.startLanguageServer",
      async () => {
        await set_language_server_enabled(true);
        await sync_language_server_state(context, output_channel);
        void vscode.window.showInformationMessage(
          "Svelte Effect Runtime language server enabled.",
        );
      },
    ),
    vscode.commands.registerCommand(
      "svelte-effect-runtime.stopLanguageServer",
      async () => {
        await set_language_server_enabled(false);
        await sync_language_server_state(context, output_channel);
        void vscode.window.showInformationMessage(
          "Svelte Effect Runtime language server disabled.",
        );
      },
    ),
    vscode.commands.registerCommand(
      "svelte-effect-runtime.restartLanguageServer",
      async () => {
        await restart_language_server(context, output_channel);
        void vscode.window.showInformationMessage(
          "Svelte Effect Runtime language server restarted.",
        );
      },
    ),
    vscode.commands.registerCommand(
      "svelte-effect-runtime.showOutput",
      () => output_channel.show(true),
    ),
    vscode.workspace.onDidChangeConfiguration(
      (event: vscode.ConfigurationChangeEvent) => {
        if (!affects_language_server_configuration(event)) {
          return;
        }

        void sync_language_server_state(context, output_channel);
      },
    ),
  );

  await migrate_legacy_svelte_configuration(context);
  await sync_language_server_state(context, output_channel);
}

/**
 * Stops the active language client when VS Code unloads the extension.
 *
 * @example
 * ```ts
 * await deactivate();
 * ```
 *
 * @since 2.0.0
 * @returns A promise that resolves once the language client has stopped.
 */
export async function deactivate(): Promise<void> {
  await stop_language_server();
}

async function sync_language_server_state(
  context: vscode.ExtensionContext,
  output_channel: vscode.OutputChannel,
): Promise<void> {
  const server_path = get_server_path(context);

  if (!is_language_server_enabled()) {
    await stop_language_server();
    await restore_svelte_extension_configuration(context);

    return;
  }

  const client_mode = get_client_mode();
  const svelte_extension = vscode.extensions.getExtension(SVELTE_EXTENSION_ID);
  const should_use_svelte_extension = client_mode === "svelteExtension" ||
    (client_mode === "auto" && svelte_extension !== undefined);

  if (should_use_svelte_extension) {
    await stop_language_server();

    if (!svelte_extension) {
      output_channel.appendLine(
        "Svelte extension client mode selected, but svelte.svelte-vscode is not installed.",
      );

      return;
    }

    const configured = await configure_svelte_extension_language_server(
      context,
      server_path,
      { force: client_mode === "svelteExtension" },
    );

    if (!configured) {
      output_channel.appendLine(
        "Svelte extension has a custom language-server.ls-path. Leaving it unchanged to avoid clobbering user settings.",
      );
    }

    return;
  }

  await restore_svelte_extension_configuration(context);
  await start_language_server(output_channel, server_path);
}

async function start_language_server(
  output_channel: vscode.OutputChannel,
  server_path: string,
): Promise<void> {
  if (client) {
    return;
  }

  const server_options = create_server_options(server_path);
  const client_options = create_client_options(output_channel);
  const next_client = new LanguageClient(
    CLIENT_ID,
    CLIENT_NAME,
    server_options,
    client_options,
  );

  client = next_client;

  try {
    await next_client.start();
  } catch (error) {
    client = undefined;
    output_channel.appendLine(format_error(error));

    throw error;
  }
}

async function stop_language_server(): Promise<void> {
  const active_client = client;

  if (!active_client) {
    return;
  }

  client = undefined;
  await active_client.stop();
  active_client.dispose();
}

async function restart_language_server(
  context: vscode.ExtensionContext,
  output_channel: vscode.OutputChannel,
): Promise<void> {
  await stop_language_server();
  await sync_language_server_state(context, output_channel);
}

function create_server_options(server_path: string): ServerOptions {
  const executable = create_server_executable(server_path);

  return {
    run: executable,
    debug: executable,
  };
}

function create_server_executable(server_path: string): Executable {
  const workspace_folder = vscode.workspace.workspaceFolders?.[0];

  return {
    command: process.execPath,
    args: [server_path, "--stdio"],
    options: {
      cwd: workspace_folder?.uri.fsPath,
      env: process.env,
    },
    transport: TransportKind.stdio,
  };
}

function create_client_options(
  output_channel: vscode.OutputChannel,
): LanguageClientOptions {
  return {
    documentSelector: [
      { scheme: "file", language: "svelte" },
      { scheme: "untitled", language: "svelte" },
    ],
    initializationOptions: create_initialization_options(),
    outputChannel: output_channel,
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher(
        "**/*.{svelte,ts,js,mjs,cjs,json}",
      ),
    },
  };
}

function create_initialization_options(): Record<string, unknown> {
  const language_config = {
    inlayHints: {
      parameterNames: {
        enabled: "all",
        suppressWhenArgumentMatchesName: false,
      },
      parameterTypes: {
        enabled: true,
      },
      variableTypes: {
        enabled: true,
        suppressWhenTypeMatchesName: false,
      },
      propertyDeclarationTypes: {
        enabled: true,
      },
      functionLikeReturnTypes: {
        enabled: true,
      },
      enumMemberValues: {
        enabled: true,
      },
    },
  };

  return {
    provideFormatter: true,
    dontFilterIncompleteCompletions: true,
    configuration: {
      javascript: language_config,
      typescript: language_config,
    },
  };
}

async function migrate_legacy_svelte_configuration(
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

async function configure_svelte_extension_language_server(
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

async function restore_svelte_extension_configuration(
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

function affects_language_server_configuration(
  event: vscode.ConfigurationChangeEvent,
): boolean {
  return event.affectsConfiguration(`${CONFIG_ROOT}.${CONFIG_ENABLED}`) ||
    event.affectsConfiguration(`${CONFIG_ROOT}.${CONFIG_CLIENT_MODE}`) ||
    event.affectsConfiguration(`${CONFIG_ROOT}.${CONFIG_SERVER_PATH}`);
}

function is_language_server_enabled(): boolean {
  return vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .get(CONFIG_ENABLED, true);
}

async function set_language_server_enabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .update(
      CONFIG_ENABLED,
      enabled,
      vscode.ConfigurationTarget.Global,
    );
}

function get_client_mode(): ClientMode {
  return vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .get<ClientMode>(CONFIG_CLIENT_MODE, "auto");
}

function get_server_path(context: vscode.ExtensionContext): string {
  return get_configured_server_path() ??
    context.asAbsolutePath(path.join(".dist", "server.cjs"));
}

function get_configured_server_path(): string | undefined {
  const configured_path = vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .get(CONFIG_SERVER_PATH, "")
    .trim();

  return configured_path.length === 0 ? undefined : configured_path;
}

function paths_equal(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return path.normalize(left).toLowerCase() ===
    path.normalize(right).toLowerCase();
}

function format_error(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}
