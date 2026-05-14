import * as vscode from "vscode";

const CONFIG_ROOT = "svelte-effect-runtime";
const CONFIG_KEY = "languageServer.autoConfigure";
const TARGET_KEY = "language-server.ls-path";
const STATE_PREVIOUS_PATH = "svelteEffectRuntime.previousLsPath";
const STATE_MANAGED_PATH = "svelteEffectRuntime.managedLsPath";

export async function activate(context: vscode.ExtensionContext) {
  const server_path = context.asAbsolutePath(".dist/server.js");

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "svelte-effect-runtime.enableLanguageServer",
      async () => {
        await configure_language_server(context, server_path, { force: true });
        void vscode.window.showInformationMessage(
          "Svelte Effect Runtime language server enabled.",
        );
      },
    ),
    vscode.commands.registerCommand(
      "svelte-effect-runtime.disableLanguageServer",
      async () => {
        await disable_language_server(context);
        void vscode.window.showInformationMessage(
          "Svelte Effect Runtime language server disabled.",
        );
      },
    ),
  );

  const auto_configure = vscode.workspace
    .getConfiguration(CONFIG_ROOT)
    .get(CONFIG_KEY, true);

  if (auto_configure) {
    await configure_language_server(context, server_path, { force: false });
  }
}

async function configure_language_server(
  context: vscode.ExtensionContext,
  server_path: string,
  options: { force: boolean },
) {
  const svelte_config = vscode.workspace.getConfiguration("svelte");
  const current_path = svelte_config.get<string | undefined>(TARGET_KEY);
  const managed_path = context.globalState.get<string | undefined>(
    STATE_MANAGED_PATH,
  );

  const can_auto_configure = !current_path ||
    current_path === managed_path ||
    current_path === server_path;

  if (!options.force && !can_auto_configure) {
    return;
  }

  if (
    current_path &&
    current_path !== server_path &&
    current_path !== managed_path
  ) {
    await context.globalState.update(STATE_PREVIOUS_PATH, current_path);
  }

  await svelte_config.update(
    TARGET_KEY,
    server_path,
    vscode.ConfigurationTarget.Global,
  );
  await context.globalState.update(STATE_MANAGED_PATH, server_path);
}

async function disable_language_server(context: vscode.ExtensionContext) {
  const svelte_config = vscode.workspace.getConfiguration("svelte");
  const previous_path = context.globalState.get<string | undefined>(
    STATE_PREVIOUS_PATH,
  );

  await svelte_config.update(
    TARGET_KEY,
    previous_path ?? undefined,
    vscode.ConfigurationTarget.Global,
  );
  await context.globalState.update(STATE_MANAGED_PATH, undefined);
}

export function deactivate() {}
