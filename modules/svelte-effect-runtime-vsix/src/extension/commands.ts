import * as vscode from "vscode";

/**
 * Command callbacks registered by the VS Code extension entrypoint.
 *
 * @example
 * ```ts
 * const handlers: LanguageServerCommandHandlers = { start, stop, restart, show_output };
 * ```
 *
 * @since 2.0.0
 */
export interface LanguageServerCommandHandlers {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  show_output: () => void;
}

/**
 * Registers all extension commands that control language-server state.
 *
 * @example
 * ```ts
 * register_language_server_commands(context, handlers);
 * ```
 *
 * @since 2.0.0
 * @param context - VS Code extension context that owns subscriptions.
 * @param handlers - Command callbacks supplied by the entrypoint.
 * @returns Nothing.
 */
export function register_language_server_commands(
  context: vscode.ExtensionContext,
  handlers: LanguageServerCommandHandlers,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "svelte-effect-runtime.startLanguageServer",
      handlers.start,
    ),
    vscode.commands.registerCommand(
      "svelte-effect-runtime.stopLanguageServer",
      handlers.stop,
    ),
    vscode.commands.registerCommand(
      "svelte-effect-runtime.restartLanguageServer",
      handlers.restart,
    ),
    vscode.commands.registerCommand(
      "svelte-effect-runtime.showOutput",
      handlers.show_output,
    ),
  );
}
