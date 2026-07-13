import type { SubscriptionContext } from "./types.ts";

import * as vscode from "vscode";

export interface LanguageServerCommandHandlers {
	start: () => Promise<void>;
	stop: () => Promise<void>;
	restart: () => Promise<void>;
	show_output: () => void;
}

export function register_language_server_commands(
	context: SubscriptionContext,
	handlers: LanguageServerCommandHandlers,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"svelte-effect-runtime.startLanguageServer",
			handlers.start,
		),
		vscode.commands.registerCommand("svelte-effect-runtime.stopLanguageServer", handlers.stop),
		vscode.commands.registerCommand(
			"svelte-effect-runtime.restartLanguageServer",
			handlers.restart,
		),
		vscode.commands.registerCommand("svelte-effect-runtime.showOutput", handlers.show_output),
	);
}
