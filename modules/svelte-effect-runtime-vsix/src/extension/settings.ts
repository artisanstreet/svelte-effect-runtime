import {
	config_client_mode,
	config_enabled,
	config_root,
	config_server_path,
	legacy_target_key,
} from "./constants.ts";
import type { ScopedServerPathConfiguration } from "./server-path-policy.ts";
import { ClientModeSchema, type ClientMode } from "./types.ts";
import { Context, Effect, Layer, Schema } from "effect";

import * as vscode from "vscode";

export class ExtensionConfiguration extends Context.Service<
	ExtensionConfiguration,
	{
		readonly get_client_mode: Effect.Effect<ClientMode>;
		readonly get_enabled: Effect.Effect<boolean>;
		readonly inspect_runtime_server_path: Effect.Effect<ScopedServerPathConfiguration>;
		readonly inspect_svelte_server_path: Effect.Effect<ScopedServerPathConfiguration>;
		readonly set_enabled: (enabled: boolean) => Effect.Effect<void, unknown>;
		readonly write_svelte_server_path: (
			value: string | undefined,
		) => Effect.Effect<void, unknown>;
	}
>()("svelte-effect-runtime-vsix/ExtensionConfiguration") {}

export const ExtensionConfigurationLive = Layer.succeed(ExtensionConfiguration, {
	get_client_mode: Effect.gen(function* () {
		const raw_mode = yield* Effect.sync(() =>
			vscode.workspace.getConfiguration(config_root).get<unknown>(config_client_mode, "auto"),
		);

		return yield* Schema.decodeUnknownEffect(ClientModeSchema)(raw_mode).pipe(
			Effect.orElseSucceed((): ClientMode => "auto"),
		);
	}),
	get_enabled: Effect.gen(function* () {
		const raw_enabled = yield* Effect.sync(() =>
			vscode.workspace.getConfiguration(config_root).get<unknown>(config_enabled, true),
		);

		return yield* Schema.decodeUnknownEffect(Schema.Boolean)(raw_enabled).pipe(
			Effect.orElseSucceed(() => true),
		);
	}),
	inspect_runtime_server_path: Effect.sync(() =>
		inspect_server_path_configuration(
			vscode.workspace.getConfiguration(config_root).inspect(config_server_path),
		),
	),
	inspect_svelte_server_path: Effect.sync(() =>
		inspect_server_path_configuration(
			vscode.workspace.getConfiguration("svelte").inspect(legacy_target_key),
		),
	),
	set_enabled: (enabled) =>
		Effect.gen(function* () {
			yield* Effect.tryPromise(() =>
				vscode.workspace
					.getConfiguration(config_root)
					.update(config_enabled, enabled, vscode.ConfigurationTarget.Global),
			);
		}),
	write_svelte_server_path: (value) =>
		Effect.gen(function* () {
			yield* Effect.tryPromise(() =>
				vscode.workspace
					.getConfiguration("svelte")
					.update(legacy_target_key, value, vscode.ConfigurationTarget.Global),
			);
		}),
});

export function affects_language_server_configuration(
	affects_configuration: (section: string) => boolean,
): boolean {
	return (
		affects_configuration(`${config_root}.${config_enabled}`) ||
		affects_configuration(`${config_root}.${config_client_mode}`) ||
		affects_configuration(`${config_root}.${config_server_path}`)
	);
}

export const GetLanguageServerEnabled = Effect.gen(function* () {
	const configuration = yield* ExtensionConfiguration;

	return yield* configuration.get_enabled;
});

export const SetLanguageServerEnabled = (enabled: boolean) =>
	Effect.gen(function* () {
		const configuration = yield* ExtensionConfiguration;

		yield* configuration.set_enabled(enabled);
	});

export const GetClientMode = Effect.gen(function* () {
	const configuration = yield* ExtensionConfiguration;

	return yield* configuration.get_client_mode;
});

function inspect_server_path_configuration(
	inspection: ReturnType<vscode.WorkspaceConfiguration["inspect"]>,
): ScopedServerPathConfiguration {
	return {
		global_path: inspection?.globalValue,
		workspace_folder_language_path: inspection?.workspaceFolderLanguageValue,
		workspace_folder_path: inspection?.workspaceFolderValue,
		workspace_language_path: inspection?.workspaceLanguageValue,
		workspace_path: inspection?.workspaceValue,
	};
}
