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

/**
 * Records legacy managed Svelte-extension configuration from older releases.
 *
 * @example
 * ```ts
 * yield* MigrateLegacySvelteConfiguration(context);
 * ```
 *
 * @since 4.0.1
 * @param context - VS Code extension context used for global state.
 * @returns An Effect that completes once migration state has been updated.
 */
export function MigrateLegacySvelteConfiguration(
	context: LegacyMigrationContext,
): Effect.Effect<void, unknown> {
	return Effect.gen(function* () {
		const current_path = yield* GetGlobalSvelteLanguageServerPath;
		const legacy_server_path = context.asAbsolutePath(path.join(".dist", "server.js"));
		const managed_path = yield* ReadGlobalStatePath(context, legacy_state_managed_path);

		if (paths_equal(current_path, legacy_server_path) && Option.isNone(managed_path)) {
			yield* UpdateGlobalState(context, legacy_state_managed_path, legacy_server_path);
		}
	});
}

/**
 * Points the official Svelte extension at this extension's language server.
 *
 * @example
 * ```ts
 * const configured = yield* ConfigureSvelteExtensionLanguageServer(
 * 	context,
 * 	server_path,
 * 	{ force: false },
 * );
 * ```
 *
 * @since 4.0.1
 * @param context - VS Code extension context used for global state.
 * @param server_path - Absolute path to the SER language-server script.
 * @param options - Configuration behavior for user-owned settings.
 * @returns An Effect yielding whether the Svelte extension was configured.
 */
export function ConfigureSvelteExtensionLanguageServer(
	context: GlobalStateContext,
	server_path: string,
	options: { force: boolean },
): Effect.Effect<boolean, unknown, FileSystem.FileSystem> {
	return Effect.gen(function* () {
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
}

/**
 * Restores the user's previous official Svelte extension language-server path.
 *
 * @example
 * ```ts
 * yield* RestoreSvelteExtensionConfiguration(context);
 * ```
 *
 * @since 4.0.1
 * @param context - VS Code extension context used for global state.
 * @returns An Effect that completes after managed settings are restored.
 */
export function RestoreSvelteExtensionConfiguration(
	context: GlobalStateContext,
): Effect.Effect<void, unknown> {
	return Effect.gen(function* () {
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
}

function ReadGlobalStatePath(
	context: GlobalStateContext,
	key: string,
): Effect.Effect<Option.Option<string>> {
	return Effect.gen(function* () {
		const value = yield* Effect.sync(() => context.globalState.get<unknown>(key));

		return Schema.decodeUnknownOption(Schema.String)(value);
	});
}

function UpdateGlobalState(
	context: GlobalStateContext,
	key: string,
	value: string | undefined,
): Effect.Effect<void, unknown> {
	return Effect.gen(function* () {
		yield* Effect.tryPromise(() => context.globalState.update(key, value));
	});
}

function UpdateConfiguration(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	value: string | undefined,
): Effect.Effect<void, unknown> {
	return Effect.gen(function* () {
		yield* Effect.tryPromise(() =>
			configuration.update(key, value, vscode.ConfigurationTarget.Global),
		);
	});
}

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
