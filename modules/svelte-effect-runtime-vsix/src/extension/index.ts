import {
	configure_svelte_extension_language_server,
	migrate_legacy_svelte_configuration,
	restore_svelte_extension_configuration,
} from "./svelte-extension-config.ts";
import {
	affects_language_server_configuration,
	get_client_mode,
	is_language_server_enabled,
	set_language_server_enabled,
} from "./settings.ts";
import { start_language_server, stop_language_server } from "./client.ts";
import { CLIENT_NAME, SVELTE_EXTENSION_ID } from "./constants.ts";
import { register_language_server_commands } from "./commands.ts";
import { get_server_path } from "./server-path.ts";

import * as vscode from "vscode";

/**
 * Starts the VS Code extension and launches or delegates language-server
 * support according to user settings.
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
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output_channel = vscode.window.createOutputChannel(CLIENT_NAME);
	const sync = async () => {
		return await sync_language_server_state(context, output_channel);
	};

	context.subscriptions.push(
		output_channel,
		vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
			if (!affects_language_server_configuration(event)) {
				return;
			}

			void run_language_server_command(output_channel, sync);
		}),
	);

	register_language_server_commands(context, {
		start: () =>
			run_language_server_command(output_channel, async () => {
				await set_language_server_enabled(true);

				const state = await sync();
				await restart_delegated_svelte_language_server(output_channel, state);

				void vscode.window.showInformationMessage(
					"Svelte Effect Runtime language server enabled.",
				);
			}),
		stop: () =>
			run_language_server_command(output_channel, async () => {
				await set_language_server_enabled(false);

				const state = await sync();
				await restart_delegated_svelte_language_server(output_channel, state);

				void vscode.window.showInformationMessage(
					"Svelte Effect Runtime language server disabled.",
				);
			}),
		restart: () =>
			run_language_server_command(output_channel, async () => {
				await stop_language_server();

				const state = await sync();
				await restart_delegated_svelte_language_server(output_channel, state);

				void vscode.window.showInformationMessage(
					"Svelte Effect Runtime language server restarted.",
				);
			}),
		show_output: () =>
			run_language_server_command(output_channel, () => {
				output_channel.show(true);
			}),
	});

	await migrate_legacy_svelte_configuration(context);
	await run_language_server_command(output_channel, sync);
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
): Promise<LanguageServerSyncState> {
	const server_path = await get_server_path(context, output_channel);

	if (!is_language_server_enabled()) {
		await stop_language_server();
		await restore_svelte_extension_configuration(context);

		return "disabled";
	}

	const client_mode = get_client_mode();
	const svelte_extension = vscode.extensions.getExtension(SVELTE_EXTENSION_ID);
	const should_use_svelte_extension =
		client_mode === "svelteExtension" ||
		(client_mode === "auto" && svelte_extension !== undefined);

	if (should_use_svelte_extension) {
		await stop_language_server();

		if (!svelte_extension) {
			output_channel.appendLine(
				"Svelte extension client mode selected, but svelte.svelte-vscode is not installed.",
			);

			return "unconfigured";
		}

		const configured = await configure_svelte_extension_language_server(context, server_path, {
			force: client_mode === "svelteExtension",
		});

		if (!configured) {
			output_channel.appendLine(
				"Svelte extension has a custom language-server.ls-path. Leaving it unchanged to avoid clobbering user settings.",
			);

			return "unconfigured";
		}

		return "svelteExtension";
	}

	await restore_svelte_extension_configuration(context);
	await start_language_server(output_channel, server_path);

	return "direct";
}

type LanguageServerSyncState = "direct" | "disabled" | "svelteExtension" | "unconfigured";

async function run_language_server_command(
	output_channel: vscode.OutputChannel,
	command: () => void | Promise<void>,
): Promise<void> {
	try {
		await command();
	} catch (error) {
		const message = format_error(error);

		output_channel.appendLine(message);
		output_channel.show(true);

		void vscode.window.showErrorMessage(`Svelte Effect Runtime command failed: ${message}`);
	}
}

async function restart_delegated_svelte_language_server(
	output_channel: vscode.OutputChannel,
	state: LanguageServerSyncState,
): Promise<void> {
	if (state !== "svelteExtension" && state !== "disabled") {
		return;
	}

	const commands = await vscode.commands.getCommands(true);

	if (!commands.includes("svelte.restartLanguageServer")) {
		output_channel.appendLine(
			"Svelte extension restart command is unavailable. Restart the VS Code extension host to apply language-server path changes.",
		);

		return;
	}

	await vscode.commands.executeCommand("svelte.restartLanguageServer");
}

function format_error(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
