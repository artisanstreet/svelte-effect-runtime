import {
	assert_safe_language_server_path,
	can_configure_svelte_language_server_path,
	get_workspace_configured_server_path,
	normalize_configured_server_path,
	type ScopedServerPathConfiguration,
} from "./server-path-policy.ts";
import {
	legacy_state_managed_path,
	legacy_state_previous_path,
	legacy_target_key,
} from "./constants.ts";
import type { GlobalStateContext, LegacyMigrationContext } from "./types.ts";
import { Effect, FileSystem, Option, Schema } from "effect";
import { paths_equal } from "./paths.ts";

import path from "node:path";

import * as vscode from "vscode";

export const MigrateLegacySvelteConfiguration = (context: LegacyMigrationContext) =>
	Effect.gen(function* () {
		const current_path = yield* GetGlobalSvelteLanguageServerPath;
		const legacy_server_path = context.asAbsolutePath(path.join(".dist", "server.js"));
		const managed_path = yield* ReadGlobalStatePath(context, legacy_state_managed_path);

		if (paths_equal(current_path, legacy_server_path) && Option.isNone(managed_path)) {
			yield* UpdateGlobalState(context, legacy_state_managed_path, legacy_server_path);
		}
	});

export const ConfigureSvelteExtensionLanguageServer = (
	context: GlobalStateContext,
	server_path: string,
	options: { force: boolean },
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const scoped_path = yield* ReadScopedSvelteLanguageServerPathConfiguration;
		const workspace_path = get_workspace_configured_server_path(scoped_path);
		const svelte_config = vscode.workspace.getConfiguration("svelte");
		const current_path = normalize_configured_server_path(scoped_path.global_path);
		const current_path_exists = current_path
			? yield* file_system.exists(current_path).pipe(Effect.orElseSucceed(() => false))
			: false;
		const managed_path = yield* ReadGlobalStatePath(context, legacy_state_managed_path);
		const previous_path = yield* ReadGlobalStatePath(context, legacy_state_previous_path);
		const managed_path_value = Option.getOrUndefined(managed_path);
		const can_configure = can_configure_svelte_language_server_path({
			current_path,
			current_path_exists,
			force: options.force,
			managed_path: managed_path_value,
			server_path,
		});

		yield* Effect.try(() => assert_safe_language_server_path(server_path));

		if (workspace_path) {
			return false;
		}

		if (!options.force && !can_configure) {
			return false;
		}

		const should_record_previous_path =
			current_path &&
			current_path_exists &&
			!paths_equal(current_path, server_path) &&
			!paths_equal(current_path, managed_path_value);
		const Configure = Effect.gen(function* () {
			if (should_record_previous_path) {
				yield* UpdateGlobalState(context, legacy_state_previous_path, current_path);
			}

			yield* UpdateConfiguration(svelte_config, legacy_target_key, server_path);
			yield* UpdateGlobalState(context, legacy_state_managed_path, server_path);
		});
		const RestoreSnapshot = Effect.gen(function* () {
			yield* UpdateConfiguration(svelte_config, legacy_target_key, current_path).pipe(
				Effect.ignore,
			);
			yield* UpdateGlobalState(
				context,
				legacy_state_managed_path,
				Option.getOrUndefined(managed_path),
			).pipe(Effect.ignore);
			yield* UpdateGlobalState(
				context,
				legacy_state_previous_path,
				Option.getOrUndefined(previous_path),
			).pipe(Effect.ignore);
		});

		yield* Configure.pipe(Effect.onError(() => RestoreSnapshot));

		return true;
	});

export const RestoreSvelteExtensionConfiguration = (context: GlobalStateContext) =>
	Effect.gen(function* () {
		const svelte_config = vscode.workspace.getConfiguration("svelte");
		const current_path = yield* GetGlobalSvelteLanguageServerPath;
		const managed_path = yield* ReadGlobalStatePath(context, legacy_state_managed_path);
		const previous_path = yield* ReadGlobalStatePath(context, legacy_state_previous_path);

		if (paths_equal(current_path, Option.getOrUndefined(managed_path))) {
			yield* UpdateConfiguration(
				svelte_config,
				legacy_target_key,
				Option.getOrUndefined(previous_path),
			);
		}

		yield* UpdateGlobalState(context, legacy_state_managed_path, undefined);
		yield* UpdateGlobalState(context, legacy_state_previous_path, undefined);
	});

const ReadGlobalStatePath = (context: GlobalStateContext, key: string) =>
	Effect.gen(function* () {
		const value = yield* Effect.sync(() => context.globalState.get<unknown>(key));

		return Schema.decodeUnknownOption(Schema.String)(value);
	});

const UpdateGlobalState = (context: GlobalStateContext, key: string, value: string | undefined) =>
	Effect.gen(function* () {
		yield* Effect.tryPromise(() => context.globalState.update(key, value));
	});

const UpdateConfiguration = (
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	value: string | undefined,
) =>
	Effect.gen(function* () {
		yield* Effect.tryPromise(() =>
			configuration.update(key, value, vscode.ConfigurationTarget.Global),
		);
	});

const ReadScopedSvelteLanguageServerPathConfiguration = Effect.sync(
	(): ScopedServerPathConfiguration => {
		const inspection = vscode.workspace.getConfiguration("svelte").inspect(legacy_target_key);

		return {
			global_path: inspection?.globalValue,
			workspace_path: inspection?.workspaceValue,
			workspace_folder_path: inspection?.workspaceFolderValue,
			workspace_language_path: inspection?.workspaceLanguageValue,
			workspace_folder_language_path: inspection?.workspaceFolderLanguageValue,
		};
	},
);

const GetGlobalSvelteLanguageServerPath = Effect.gen(function* () {
	const scoped_path = yield* ReadScopedSvelteLanguageServerPathConfiguration;

	return normalize_configured_server_path(scoped_path.global_path);
});
