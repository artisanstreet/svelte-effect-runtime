import * as vscode from "vscode";

export interface LanguageServerCommandHandlers {
	start: () => Promise<void>;
	stop: () => Promise<void>;
	restart: () => Promise<void>;
	show_output: () => void;
}

export function register_language_server_commands(
	handlers: LanguageServerCommandHandlers,
): vscode.Disposable[] {
	return [
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
	];
}
