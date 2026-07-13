import {
	config_client_mode,
	config_enabled,
	config_root,
	config_server_path,
} from "./constants.ts";
import { ClientModeSchema, type ClientMode } from "./types.ts";
import { Effect, Schema } from "effect";

import * as vscode from "vscode";

/**
 * Checks whether a configuration change affects language-server state.
 *
 * @example
 * ```ts
 * if (affects_language_server_configuration(event)) sync();
 * ```
 *
 * @since 2.0.0
 * @param event - VS Code configuration-change event.
 * @returns Whether the extension should resync language-server state.
 */
export function affects_language_server_configuration(
	event: vscode.ConfigurationChangeEvent,
): boolean {
	return (
		event.affectsConfiguration(`${config_root}.${config_enabled}`) ||
		event.affectsConfiguration(`${config_root}.${config_client_mode}`) ||
		event.affectsConfiguration(`${config_root}.${config_server_path}`)
	);
}

/**
 * Reads and validates whether the extension should run a language server.
 *
 * @example
 * ```ts
 * const enabled = yield* GetLanguageServerEnabled;
 * ```
 *
 * @since 4.0.1
 */
export const GetLanguageServerEnabled: Effect.Effect<boolean> = Effect.gen(function* () {
	const raw_enabled = yield* Effect.sync(() =>
		vscode.workspace.getConfiguration(config_root).get<unknown>(config_enabled, true),
	);

	return yield* Schema.decodeUnknownEffect(Schema.Boolean)(raw_enabled).pipe(
		Effect.orElseSucceed(() => true),
	);
});

/**
 * Persists the language-server enabled setting.
 *
 * @example
 * ```ts
 * yield* SetLanguageServerEnabled(false);
 * ```
 *
 * @since 4.0.1
 * @param enabled - Desired enabled state to write globally.
 * @returns An Effect that completes once VS Code has persisted the setting.
 */
export function SetLanguageServerEnabled(enabled: boolean): Effect.Effect<void, unknown> {
	return Effect.gen(function* () {
		yield* Effect.tryPromise(() =>
			vscode.workspace
				.getConfiguration(config_root)
				.update(config_enabled, enabled, vscode.ConfigurationTarget.Global),
		);
	});
}

/**
 * Reads and validates the configured client strategy.
 *
 * @example
 * ```ts
 * const mode = yield* GetClientMode;
 * ```
 *
 * @since 4.0.1
 */
export const GetClientMode: Effect.Effect<ClientMode> = Effect.gen(function* () {
	const raw_mode = yield* Effect.sync(() =>
		vscode.workspace.getConfiguration(config_root).get<unknown>(config_client_mode, "auto"),
	);

	return yield* Schema.decodeUnknownEffect(ClientModeSchema)(raw_mode).pipe(
		Effect.orElseSucceed((): ClientMode => "auto"),
	);
});
