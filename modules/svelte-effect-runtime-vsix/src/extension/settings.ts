import {
	config_client_mode,
	config_enabled,
	config_root,
	config_server_path,
} from "./constants.ts";
import { ClientModeSchema, type ClientMode } from "./types.ts";
import { Effect, Schema } from "effect";

import * as vscode from "vscode";

export function affects_language_server_configuration(
	event: vscode.ConfigurationChangeEvent,
): boolean {
	return (
		event.affectsConfiguration(`${config_root}.${config_enabled}`) ||
		event.affectsConfiguration(`${config_root}.${config_client_mode}`) ||
		event.affectsConfiguration(`${config_root}.${config_server_path}`)
	);
}

export const GetLanguageServerEnabled: Effect.Effect<boolean> = Effect.gen(function* () {
	const raw_enabled = yield* Effect.sync(() =>
		vscode.workspace.getConfiguration(config_root).get<unknown>(config_enabled, true),
	);

	return yield* Schema.decodeUnknownEffect(Schema.Boolean)(raw_enabled).pipe(
		Effect.orElseSucceed(() => true),
	);
});

export const SetLanguageServerEnabled = (enabled: boolean) =>
	Effect.gen(function* () {
		yield* Effect.tryPromise(() =>
			vscode.workspace
				.getConfiguration(config_root)
				.update(config_enabled, enabled, vscode.ConfigurationTarget.Global),
		);
	});

export const GetClientMode: Effect.Effect<ClientMode> = Effect.gen(function* () {
	const raw_mode = yield* Effect.sync(() =>
		vscode.workspace.getConfiguration(config_root).get<unknown>(config_client_mode, "auto"),
	);

	return yield* Schema.decodeUnknownEffect(ClientModeSchema)(raw_mode).pipe(
		Effect.orElseSucceed((): ClientMode => "auto"),
	);
});
