import {
	ConfigureSvelteExtensionLanguageServer,
	MigrateLegacySvelteConfiguration,
	RestoreSvelteExtensionConfiguration,
} from "./svelte-extension-config.ts";
import {
	PackageManagerCommand,
	PackageManagerCommandLive,
	PackageManagerInstallFiles,
	PackageManagerInstallFilesLive,
} from "./package-manager-install.ts";
import {
	affects_language_server_configuration,
	GetClientMode,
	GetLanguageServerEnabled,
	SetLanguageServerEnabled,
} from "./settings.ts";
import {
	Cause,
	Context,
	Effect,
	FileSystem,
	Layer,
	ManagedRuntime,
	Option,
	Path,
	Ref,
} from "effect";
import { client_name, config_root, config_server_path, svelte_extension_id } from "./constants.ts";
import { LanguageClientControl, make_language_client_control_layer } from "./client.ts";
import { make_server_path_resolver_layer, ServerPathResolver } from "./server-path.ts";
import { normalize_configured_server_path } from "./server-path-policy.ts";
import { MakeCoordinatorShutdownGate } from "./coordinator-lifecycle.ts";
import { register_language_server_commands } from "./commands.ts";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import type { ClientMode } from "./types.ts";

import * as vscode from "vscode";

type LanguageServerSyncState = "direct" | "disabled" | "svelteExtension" | "unconfigured";
type ExtensionInfrastructure =
	| FileSystem.FileSystem
	| PackageManagerCommand
	| PackageManagerInstallFiles
	| Path.Path;

interface LanguageServerConfigurationSnapshot {
	client_mode: ClientMode;
	enabled: boolean;
	global_path: string | undefined;
	workspace_folder_language_path: string | undefined;
	workspace_folder_path: string | undefined;
	workspace_language_path: string | undefined;
	workspace_path: string | undefined;
}

interface CompletedLanguageServerSync {
	snapshot: LanguageServerConfigurationSnapshot;
	state: LanguageServerSyncState;
}

export class LanguageServerCoordinator extends Context.Service<
	LanguageServerCoordinator,
	{
		readonly restart: Effect.Effect<
			void,
			unknown,
			LanguageClientControl | ServerPathResolver | ExtensionInfrastructure
		>;
		readonly shutdown: Effect.Effect<void, unknown, LanguageClientControl>;
		readonly start: Effect.Effect<
			void,
			unknown,
			LanguageClientControl | ServerPathResolver | ExtensionInfrastructure
		>;
		readonly stop: Effect.Effect<
			void,
			unknown,
			LanguageClientControl | ServerPathResolver | ExtensionInfrastructure
		>;
		readonly sync: Effect.Effect<
			LanguageServerSyncState,
			unknown,
			LanguageClientControl | ServerPathResolver | ExtensionInfrastructure
		>;
	}
>()("svelte-effect-runtime-vsix/LanguageServerCoordinator") {}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output_channel = vscode.window.createOutputChannel(client_name);
	const runtime = make_extension_runtime(context, output_channel);
	const run_command = (program: Effect.Effect<void, unknown, ExtensionServices>) =>
		runtime.runPromise(HandleLanguageServerCommand(output_channel, program));

	extension_runtime = runtime;

	context.subscriptions.push(
		output_channel,
		vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
			if (!affects_language_server_configuration(event)) {
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

	register_language_server_commands(context, {
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
			void run_command(Effect.sync(() => output_channel.show(true)));
		},
	});

	await run_command(
		Effect.gen(function* () {
			const coordinator = yield* LanguageServerCoordinator;

			yield* MigrateLegacySvelteConfiguration(context);
			yield* coordinator.sync;
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
	context: vscode.ExtensionContext,
	output_channel: vscode.OutputChannel,
) {
	const node_services = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const install_files = PackageManagerInstallFilesLive.pipe(Layer.provide(node_services));
	const application_layer = Layer.mergeAll(
		node_services,
		PackageManagerCommandLive,
		install_files,
		make_language_client_control_layer(output_channel),
		make_server_path_resolver_layer(context, output_channel),
		make_language_server_coordinator_layer(context, output_channel),
	);

	return ManagedRuntime.make(application_layer);
}

type ExtensionRuntime = ReturnType<typeof make_extension_runtime>;
type ExtensionServices =
	| ExtensionInfrastructure
	| LanguageClientControl
	| LanguageServerCoordinator
	| ServerPathResolver;

let extension_runtime: ExtensionRuntime | undefined;

function make_language_server_coordinator_layer(
	context: vscode.ExtensionContext,
	output_channel: vscode.OutputChannel,
): Layer.Layer<LanguageServerCoordinator> {
	return Layer.effect(
		LanguageServerCoordinator,
		Effect.gen(function* () {
			const completed_sync = yield* Ref.make(Option.none<CompletedLanguageServerSync>());
			const shutdown_gate = yield* MakeCoordinatorShutdownGate();
			const Synchronize = (force: boolean) =>
				SynchronizeLanguageServerState(context, output_channel, completed_sync, force);
			const CurrentState: Effect.Effect<LanguageServerSyncState> = Ref.get(
				completed_sync,
			).pipe(
				Effect.map((current_sync) =>
					Option.isSome(current_sync) ? current_sync.value.state : "unconfigured",
				),
			);
			const Sync = shutdown_gate
				.run(Synchronize(false))
				.pipe(
					Effect.flatMap((state) =>
						Option.isSome(state) ? Effect.succeed(state.value) : CurrentState,
					),
				);
			const Start = shutdown_gate
				.run(
					Effect.gen(function* () {
						yield* SetLanguageServerEnabled(true);

						const state = yield* Synchronize(false);

						yield* RestartDelegatedSvelteLanguageServer(output_channel, state);
						yield* ShowInformationMessage(
							"Svelte Effect Runtime language server enabled.",
						);
					}),
				)
				.pipe(Effect.asVoid);
			const Stop = shutdown_gate
				.run(
					Effect.gen(function* () {
						yield* SetLanguageServerEnabled(false);

						const state = yield* Synchronize(false);

						yield* RestartDelegatedSvelteLanguageServer(output_channel, state);
						yield* ShowInformationMessage(
							"Svelte Effect Runtime language server disabled.",
						);
					}),
				)
				.pipe(Effect.asVoid);
			const Restart = shutdown_gate
				.run(
					Effect.gen(function* () {
						const client = yield* LanguageClientControl;

						yield* client.stop;

						const state = yield* Synchronize(true);

						yield* RestartDelegatedSvelteLanguageServer(output_channel, state);
						yield* ShowInformationMessage(
							"Svelte Effect Runtime language server restarted.",
						);
					}),
				)
				.pipe(Effect.asVoid);
			const Shutdown = Effect.gen(function* () {
				const client = yield* LanguageClientControl;

				yield* shutdown_gate.close;
				yield* client.stop;
			});

			return {
				restart: Restart,
				shutdown: Shutdown,
				start: Start,
				stop: Stop,
				sync: Sync,
			};
		}),
	);
}

const SynchronizeLanguageServerState = (
	context: vscode.ExtensionContext,
	output_channel: vscode.OutputChannel,
	completed_sync: Ref.Ref<Option.Option<CompletedLanguageServerSync>>,
	force: boolean,
) =>
	Effect.gen(function* () {
		const snapshot = yield* ReadLanguageServerConfigurationSnapshot;
		const previous_sync = yield* Ref.get(completed_sync);

		if (
			!force &&
			Option.isSome(previous_sync) &&
			configuration_snapshots_equal(previous_sync.value.snapshot, snapshot)
		) {
			return previous_sync.value.state;
		}

		const state = yield* ReconcileLanguageServerState(context, output_channel, snapshot);

		yield* Ref.set(completed_sync, Option.some({ snapshot, state }));

		return state;
	});

const ReconcileLanguageServerState = (
	context: vscode.ExtensionContext,
	output_channel: vscode.OutputChannel,
	snapshot: LanguageServerConfigurationSnapshot,
) =>
	Effect.gen(function* () {
		const client = yield* LanguageClientControl;

		if (!snapshot.enabled) {
			yield* client.stop;
			yield* RestoreSvelteExtensionConfiguration(context);

			return "disabled";
		}

		const svelte_extension = yield* Effect.sync(() =>
			vscode.extensions.getExtension(svelte_extension_id),
		);
		const should_use_svelte_extension =
			snapshot.client_mode === "svelteExtension" ||
			(snapshot.client_mode === "auto" && svelte_extension !== undefined);

		if (should_use_svelte_extension && !svelte_extension) {
			yield* client.stop;
			yield* AppendLine(
				output_channel,
				"Svelte extension client mode selected, but svelte.svelte-vscode is not installed.",
			);

			return "unconfigured";
		}

		const resolver = yield* ServerPathResolver;
		const server_path = yield* resolver.get;

		if (should_use_svelte_extension) {
			yield* client.stop;

			const configured = yield* ConfigureSvelteExtensionLanguageServer(context, server_path, {
				force: snapshot.client_mode === "svelteExtension",
			});

			if (!configured) {
				yield* AppendLine(
					output_channel,
					"Svelte extension has a custom language-server.ls-path. Leaving it unchanged to avoid clobbering user settings.",
				);

				return "unconfigured";
			}

			return "svelteExtension";
		}

		yield* RestoreSvelteExtensionConfiguration(context);
		yield* client.start(server_path);

		return "direct";
	});

const ReadLanguageServerConfigurationSnapshot: Effect.Effect<LanguageServerConfigurationSnapshot> =
	Effect.gen(function* () {
		const client_mode = yield* GetClientMode;
		const enabled = yield* GetLanguageServerEnabled;
		const inspection = yield* Effect.sync(() =>
			vscode.workspace.getConfiguration(config_root).inspect(config_server_path),
		);

		return {
			client_mode,
			enabled,
			global_path: normalize_configured_server_path(inspection?.globalValue),
			workspace_folder_language_path: normalize_configured_server_path(
				inspection?.workspaceFolderLanguageValue,
			),
			workspace_folder_path: normalize_configured_server_path(
				inspection?.workspaceFolderValue,
			),
			workspace_language_path: normalize_configured_server_path(
				inspection?.workspaceLanguageValue,
			),
			workspace_path: normalize_configured_server_path(inspection?.workspaceValue),
		};
	});

const RestartDelegatedSvelteLanguageServer = (
	output_channel: vscode.OutputChannel,
	state: LanguageServerSyncState,
) =>
	Effect.gen(function* () {
		if (state !== "svelteExtension" && state !== "disabled") {
			return;
		}

		const commands = yield* Effect.tryPromise(() => vscode.commands.getCommands(true));

		if (!commands.includes("svelte.restartLanguageServer")) {
			yield* AppendLine(
				output_channel,
				"Svelte extension restart command is unavailable. Restart the VS Code extension host to apply language-server path changes.",
			);

			return;
		}

		yield* Effect.tryPromise(() =>
			vscode.commands.executeCommand("svelte.restartLanguageServer"),
		);
	});

const HandleLanguageServerCommand = <R>(
	output_channel: vscode.OutputChannel,
	program: Effect.Effect<void, unknown, R>,
) =>
	Effect.catchCause(program, (cause) =>
		Effect.gen(function* () {
			const message = Cause.pretty(cause);

			yield* AppendLine(output_channel, message);
			yield* Effect.sync(() => output_channel.show(true));
			yield* Effect.tryPromise(() =>
				vscode.window.showErrorMessage(`Svelte Effect Runtime command failed: ${message}`),
			).pipe(Effect.ignore);
		}),
	);

const ShowInformationMessage = (message: string) =>
	Effect.tryPromise(() => vscode.window.showInformationMessage(message)).pipe(
		Effect.asVoid,
		Effect.ignore,
	);

const AppendLine = (output_channel: vscode.OutputChannel, message: string) =>
	Effect.sync(() => output_channel.appendLine(message));

function configuration_snapshots_equal(
	left: LanguageServerConfigurationSnapshot,
	right: LanguageServerConfigurationSnapshot,
): boolean {
	return (
		left.client_mode === right.client_mode &&
		left.enabled === right.enabled &&
		left.global_path === right.global_path &&
		left.workspace_folder_language_path === right.workspace_folder_language_path &&
		left.workspace_folder_path === right.workspace_folder_path &&
		left.workspace_language_path === right.workspace_language_path &&
		left.workspace_path === right.workspace_path
	);
}
