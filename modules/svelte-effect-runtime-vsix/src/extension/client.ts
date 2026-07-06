import {
	type Executable,
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind,
} from "vscode-languageclient/node.js";
import { assert_safe_language_server_path } from "./server-path-policy.ts";
import { create_initialization_options } from "./initialization-options.ts";
import { CLIENT_ID, CLIENT_NAME } from "./constants.ts";

import process from "node:process";

import * as vscode from "vscode";

let client: LanguageClient | undefined;

/**
 * Starts the direct VS Code language client if one is not already active.
 *
 * @example
 * ```ts
 * await start_language_server(output_channel, server_path);
 * ```
 *
 * @since 2.0.0
 * @param output_channel - Channel used for client/server diagnostics.
 * @param server_path - Absolute path to the bundled or configured server.
 * @returns A promise that resolves once the client has started.
 */
export async function start_language_server(
	output_channel: vscode.OutputChannel,
	server_path: string,
): Promise<void> {
	if (client) {
		return;
	}

	const server_options = create_server_options(server_path);
	const client_options = create_client_options(output_channel);
	const next_client = new LanguageClient(CLIENT_ID, CLIENT_NAME, server_options, client_options);

	client = next_client;

	try {
		await next_client.start();
	} catch (error) {
		client = undefined;
		output_channel.appendLine(format_error(error));

		throw error;
	}
}

/**
 * Stops and disposes the active direct language client.
 *
 * @example
 * ```ts
 * await stop_language_server();
 * ```
 *
 * @since 2.0.0
 * @returns A promise that resolves once the active client has stopped.
 */
export async function stop_language_server(): Promise<void> {
	const active_client = client;

	if (!active_client) {
		return;
	}

	client = undefined;
	await active_client.stop();
	active_client.dispose();
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

	assert_safe_language_server_path(server_path);

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

function create_client_options(output_channel: vscode.OutputChannel): LanguageClientOptions {
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

function format_error(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
