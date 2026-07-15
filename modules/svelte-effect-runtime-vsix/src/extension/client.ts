import {
	type Executable,
	LanguageClient,
	type LanguageClientOptions,
	TransportKind,
} from "vscode-languageclient/node.js";
import { MakeSerializedClientControl, type SerializedClientHandle } from "./client-lifecycle.ts";
import { LanguageClientControl, LanguageClientFactory } from "./client-control.ts";
import { create_initialization_options } from "./initialization-options.ts";
import { assert_safe_language_server_path } from "./server-path-policy.ts";
import { client_id, client_name } from "./constants.ts";
import { Effect, Layer } from "effect";

import process from "node:process";

import * as vscode from "vscode";

export { LanguageClientControl, LanguageClientFactory } from "./client-control.ts";

export const LanguageClientControlLive = Layer.effect(
	LanguageClientControl,
	Effect.gen(function* () {
		const factory = yield* LanguageClientFactory;

		return yield* MakeSerializedClientControl(factory.create);
	}),
);

export function make_language_client_factory_layer(
	output_channel: vscode.OutputChannel,
): Layer.Layer<LanguageClientFactory> {
	const CreateClient = (server_path: string) =>
		Effect.gen(function* () {
			yield* Effect.try(() => assert_safe_language_server_path(server_path));

			const file_watcher = yield* Effect.sync(() =>
				vscode.workspace.createFileSystemWatcher("**/*.{svelte,sv,ts,js,mjs,cjs,json}"),
			);
			const AcquireClient = Effect.gen(function* () {
				const client_options = create_client_options(file_watcher);
				const server_options = yield* CreateServerOptions(server_path);
				const next_client = yield* Effect.try(
					() =>
						new LanguageClient(client_id, client_name, server_options, client_options),
				);

				return {
					start: Effect.tryPromise(() => next_client.start()).pipe(
						Effect.tapError((error) =>
							Effect.sync(() => output_channel.appendLine(format_error(error))),
						),
					),
					stop: Effect.tryPromise(() => next_client.stop()),
					dispose: Effect.sync(() => {
						next_client.dispose();
						file_watcher.dispose();
					}),
				} satisfies SerializedClientHandle;
			}).pipe(Effect.onError(() => Effect.sync(() => file_watcher.dispose())));

			return yield* AcquireClient;
		});
	const create_client_options = (
		file_watcher: vscode.FileSystemWatcher,
	): LanguageClientOptions => ({
		documentSelector: [
			{ scheme: "file", language: "svelte" },
			{ scheme: "untitled", language: "svelte" },
		],
		initializationOptions: create_initialization_options(),
		outputChannel: output_channel,
		synchronize: {
			fileEvents: file_watcher,
		},
	});

	return Layer.succeed(LanguageClientFactory, { create: CreateClient });
}

const CreateServerOptions = (server_path: string) =>
	Effect.gen(function* () {
		const workspace_folder = yield* Effect.sync(() => vscode.workspace.workspaceFolders?.[0]);
		const environment = yield* Effect.sync(() => process.env);
		const executable = create_server_executable(
			server_path,
			workspace_folder?.uri.fsPath,
			environment,
		);

		return {
			run: executable,
			debug: executable,
		};
	});

function create_server_executable(
	server_path: string,
	workspace_path: string | undefined,
	environment: NodeJS.ProcessEnv,
): Executable {
	return {
		command: process.execPath,
		args: [server_path, "--stdio"],
		options: {
			...(workspace_path === undefined ? {} : { cwd: workspace_path }),
			env: environment,
		},
		transport: TransportKind.stdio,
	};
}

function format_error(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
