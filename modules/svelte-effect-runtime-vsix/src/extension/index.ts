import {
	ExtensionOutput,
	ExtensionState,
	make_extension_output_layer,
	make_extension_state_layer,
} from "./extension-services.ts";
import {
	LanguageServerCoordinator,
	LanguageServerCoordinatorLive,
} from "./language-server-coordinator.ts";
import {
	PackageManagerCommandLive,
	PackageManagerInstallFilesLive,
} from "./package-manager-install.ts";
import { affects_language_server_configuration, ExtensionConfigurationLive } from "./settings.ts";
import { LanguageClientControlLive, make_language_client_factory_layer } from "./client.ts";
import { ServerInstallRetentionPolicyLive } from "./server-install-retention/index.ts";
import { SvelteExtensionControlLive } from "./svelte-extension-control.ts";
import { make_server_path_resolver_layer } from "./server-path.ts";
import { register_language_server_commands } from "./commands.ts";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Cause, Effect, Layer, ManagedRuntime } from "effect";
import { LanguageClientFactory } from "./client-control.ts";
import { client_name } from "./constants.ts";

import path from "node:path";

import * as vscode from "vscode";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output_channel = vscode.window.createOutputChannel(client_name);
	const legacy_server_path = context.asAbsolutePath(path.join(".dist", "server.js"));
	const runtime = make_extension_runtime(
		context.globalStorageUri.fsPath,
		make_extension_state_layer(context.globalState),
		make_extension_output_layer(output_channel),
		make_language_client_factory_layer(output_channel),
	);
	const run_command = (program: Effect.Effect<void, unknown, ExtensionServices>) =>
		runtime.runPromise(HandleLanguageServerCommand(program));

	extension_runtime = runtime;

	context.subscriptions.push(
		output_channel,
		vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
			if (
				!affects_language_server_configuration((section) =>
					event.affectsConfiguration(section),
				)
			) {
				return;
			}

			void run_command(
				Effect.gen(function* () {
					const coordinator = yield* LanguageServerCoordinator;

					yield* coordinator.sync;
				}),
			);
		}),
	);

	context.subscriptions.push(
		...register_language_server_commands({
			start: () =>
				run_command(
					Effect.gen(function* () {
						const coordinator = yield* LanguageServerCoordinator;

						yield* coordinator.start;
					}),
				),
			stop: () =>
				run_command(
					Effect.gen(function* () {
						const coordinator = yield* LanguageServerCoordinator;

						yield* coordinator.stop;
					}),
				),
			restart: () =>
				run_command(
					Effect.gen(function* () {
						const coordinator = yield* LanguageServerCoordinator;

						yield* coordinator.restart;
					}),
				),
			show_output: () => {
				void run_command(
					Effect.gen(function* () {
						const output = yield* ExtensionOutput;

						yield* output.show;
					}),
				);
			},
		}),
	);

	await run_command(
		Effect.gen(function* () {
			const coordinator = yield* LanguageServerCoordinator;

			yield* coordinator.initialize(legacy_server_path);
		}),
	);
}

export async function deactivate(): Promise<void> {
	const runtime = extension_runtime;

	extension_runtime = undefined;

	if (!runtime) {
		return;
	}

	await runtime.runPromise(
		Effect.gen(function* () {
			const coordinator = yield* LanguageServerCoordinator;

			yield* coordinator.shutdown;
		}).pipe(Effect.ensuring(runtime.disposeEffect)),
	);
}

function make_extension_runtime(
	storage_path: string,
	state_layer: Layer.Layer<ExtensionState>,
	output_layer: Layer.Layer<ExtensionOutput>,
	client_factory_layer: Layer.Layer<LanguageClientFactory>,
) {
	const node_services = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const install_files = PackageManagerInstallFilesLive.pipe(Layer.provide(node_services));
	const client_control = LanguageClientControlLive.pipe(Layer.provide(client_factory_layer));
	const resolver_dependencies = Layer.mergeAll(
		node_services,
		output_layer,
		ExtensionConfigurationLive,
		PackageManagerCommandLive,
		install_files,
		ServerInstallRetentionPolicyLive,
	);
	const resolver = make_server_path_resolver_layer(storage_path).pipe(
		Layer.provide(resolver_dependencies),
	);
	const coordinator_dependencies = Layer.mergeAll(
		NodeFileSystem.layer,
		state_layer,
		output_layer,
		ExtensionConfigurationLive,
		SvelteExtensionControlLive,
		client_control,
		resolver,
	);
	const coordinator = LanguageServerCoordinatorLive.pipe(Layer.provide(coordinator_dependencies));
	const application_layer = Layer.merge(output_layer, coordinator);

	return ManagedRuntime.make(application_layer);
}

type ExtensionRuntime = ReturnType<typeof make_extension_runtime>;
type ExtensionServices = ExtensionOutput | LanguageServerCoordinator;

let extension_runtime: ExtensionRuntime | undefined;

const HandleLanguageServerCommand = <R>(program: Effect.Effect<void, unknown, R>) =>
	Effect.catchCause(program, (cause) =>
		Effect.gen(function* () {
			const output = yield* ExtensionOutput;
			const message = Cause.pretty(cause);

			yield* output.append_line(message);
			yield* output.show;
			yield* output.show_error(`Svelte Effect Runtime command failed: ${message}`);
		}),
	);
