import {
	ConfigureSvelteExtensionLanguageServer,
	MigrateLegacySvelteConfiguration,
	RestoreSvelteExtensionConfiguration,
} from "./svelte-extension-config.ts";
import {
	configuration_snapshots_equal,
	resolve_language_server_client_target,
	type LanguageServerConfigurationSnapshot,
} from "./language-server-state.ts";
import {
	GetClientMode,
	GetLanguageServerEnabled,
	SetLanguageServerEnabled,
	ExtensionConfiguration,
} from "./settings.ts";
import { normalize_configured_server_path } from "./server-path-policy.ts";
import { ExtensionOutput, ExtensionState } from "./extension-services.ts";
import { MakeCoordinatorShutdownGate } from "./coordinator-lifecycle.ts";
import { Context, Effect, FileSystem, Layer, Option, Ref } from "effect";
import { SvelteExtensionControl } from "./svelte-extension-control.ts";
import { LanguageClientControl } from "./client-control.ts";
import { ServerPathResolver } from "./server-path.ts";

type LanguageServerSyncState = "direct" | "disabled" | "svelteExtension" | "unconfigured";
type LanguageServerCoordinatorDependencies =
	| ExtensionConfiguration
	| ExtensionOutput
	| ExtensionState
	| FileSystem.FileSystem
	| LanguageClientControl
	| ServerPathResolver
	| SvelteExtensionControl;

interface CompletedLanguageServerSync {
	snapshot: LanguageServerConfigurationSnapshot;
	state: LanguageServerSyncState;
}

export class LanguageServerCoordinator extends Context.Service<
	LanguageServerCoordinator,
	{
		readonly initialize: (legacy_server_path: string) => Effect.Effect<void, unknown>;
		readonly restart: Effect.Effect<void, unknown>;
		readonly shutdown: Effect.Effect<void, unknown>;
		readonly start: Effect.Effect<void, unknown>;
		readonly stop: Effect.Effect<void, unknown>;
		readonly sync: Effect.Effect<LanguageServerSyncState, unknown>;
	}
>()("svelte-effect-runtime-vsix/LanguageServerCoordinator") {}

export const LanguageServerCoordinatorLive = Layer.effect(
	LanguageServerCoordinator,
	Effect.gen(function* () {
		const dependency_context = yield* Effect.context<LanguageServerCoordinatorDependencies>();
		const completed_sync = yield* Ref.make(Option.none<CompletedLanguageServerSync>());
		const shutdown_gate = yield* MakeCoordinatorShutdownGate();
		const Synchronize = (force: boolean) =>
			SynchronizeLanguageServerState(completed_sync, force);
		const CurrentState = Ref.get(completed_sync).pipe(
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

					yield* RestartDelegatedSvelteLanguageServer(state);
					yield* ShowInformationMessage("Svelte Effect Runtime language server enabled.");
				}),
			)
			.pipe(Effect.asVoid);
		const Stop = shutdown_gate
			.run(
				Effect.gen(function* () {
					yield* SetLanguageServerEnabled(false);

					const state = yield* Synchronize(false);

					yield* RestartDelegatedSvelteLanguageServer(state);
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

					yield* RestartDelegatedSvelteLanguageServer(state);
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
		const Initialize = (legacy_server_path: string) =>
			Effect.gen(function* () {
				yield* MigrateLegacySvelteConfiguration(legacy_server_path);
				yield* Sync;
			}).pipe(Effect.asVoid);

		return {
			initialize: (legacy_server_path: string) =>
				Initialize(legacy_server_path).pipe(Effect.provide(dependency_context)),
			restart: Restart.pipe(Effect.provide(dependency_context)),
			shutdown: Shutdown.pipe(Effect.provide(dependency_context)),
			start: Start.pipe(Effect.provide(dependency_context)),
			stop: Stop.pipe(Effect.provide(dependency_context)),
			sync: Sync.pipe(Effect.provide(dependency_context)),
		};
	}),
);

const SynchronizeLanguageServerState = (
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

		const state = yield* ReconcileLanguageServerState(snapshot);

		yield* Ref.set(completed_sync, Option.some({ snapshot, state }));

		return state;
	});

const ReconcileLanguageServerState = (snapshot: LanguageServerConfigurationSnapshot) =>
	Effect.gen(function* () {
		const output = yield* ExtensionOutput;
		const client = yield* LanguageClientControl;

		if (!snapshot.enabled) {
			yield* client.stop;
			yield* RestoreSvelteExtensionConfiguration;

			return "disabled";
		}

		const client_target = resolve_language_server_client_target(snapshot);

		if (client_target === "unavailable") {
			yield* client.stop;
			yield* output.append_line(
				"Svelte extension client mode selected, but svelte.svelte-vscode is not installed.",
			);

			return "unconfigured";
		}

		const resolver = yield* ServerPathResolver;
		const server_path = yield* resolver.get;

		if (client_target === "svelteExtension") {
			yield* client.stop;

			const configured = yield* ConfigureSvelteExtensionLanguageServer(server_path, {
				force: snapshot.client_mode === "svelteExtension",
			});

			if (!configured) {
				yield* output.append_line(
					"Svelte extension has a custom language-server.ls-path. Leaving it unchanged to avoid clobbering user settings.",
				);

				return "unconfigured";
			}

			return "svelteExtension";
		}

		yield* RestoreSvelteExtensionConfiguration;
		yield* client.start(server_path);

		return "direct";
	});

const ReadLanguageServerConfigurationSnapshot = Effect.gen(function* () {
	const configuration = yield* ExtensionConfiguration;
	const svelte_extension = yield* SvelteExtensionControl;
	const client_mode = yield* GetClientMode;
	const enabled = yield* GetLanguageServerEnabled;
	const svelte_extension_available = yield* svelte_extension.available;
	const inspection = yield* configuration.inspect_runtime_server_path;

	return {
		client_mode,
		enabled,
		svelte_extension_available,
		global_path: normalize_configured_server_path(inspection.global_path),
		workspace_folder_language_path: normalize_configured_server_path(
			inspection.workspace_folder_language_path,
		),
		workspace_folder_path: normalize_configured_server_path(inspection.workspace_folder_path),
		workspace_language_path: normalize_configured_server_path(
			inspection.workspace_language_path,
		),
		workspace_path: normalize_configured_server_path(inspection.workspace_path),
	};
});

const RestartDelegatedSvelteLanguageServer = (state: LanguageServerSyncState) =>
	Effect.gen(function* () {
		const svelte_extension = yield* SvelteExtensionControl;
		const output = yield* ExtensionOutput;

		if (state !== "svelteExtension" && state !== "disabled") {
			return;
		}

		const restarted = yield* svelte_extension.restart;

		if (!restarted) {
			yield* output.append_line(
				"Svelte extension restart command is unavailable. Restart the VS Code extension host to apply language-server path changes.",
			);
		}
	});

const ShowInformationMessage = (message: string) =>
	Effect.gen(function* () {
		const output = yield* ExtensionOutput;

		yield* output.show_information(message);
	});
