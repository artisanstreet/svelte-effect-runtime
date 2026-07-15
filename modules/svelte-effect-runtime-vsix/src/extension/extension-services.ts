import { Context, Effect, Layer, Option, Schema } from "effect";

import * as vscode from "vscode";

export class ExtensionState extends Context.Service<
	ExtensionState,
	{
		readonly read_path: (key: string) => Effect.Effect<Option.Option<string>>;
		readonly write_path: (
			key: string,
			value: string | undefined,
		) => Effect.Effect<void, unknown>;
	}
>()("svelte-effect-runtime-vsix/ExtensionState") {}

export class ExtensionOutput extends Context.Service<
	ExtensionOutput,
	{
		readonly append_line: (message: string) => Effect.Effect<void>;
		readonly show: Effect.Effect<void>;
		readonly show_error: (message: string) => Effect.Effect<void>;
		readonly show_information: (message: string) => Effect.Effect<void>;
	}
>()("svelte-effect-runtime-vsix/ExtensionOutput") {}

export const make_extension_state_layer = (global_state: Pick<vscode.Memento, "get" | "update">) =>
	Layer.succeed(ExtensionState, {
		read_path: (key) =>
			Effect.gen(function* () {
				const value = yield* Effect.sync(() => global_state.get<unknown>(key));
				const decoded = Schema.decodeUnknownOption(Schema.String)(value);

				return Option.filter(decoded, (path) => path.trim().length > 0);
			}),
		write_path: (key, value) =>
			Effect.gen(function* () {
				yield* Effect.tryPromise(() => global_state.update(key, value));
			}),
	});

export const make_extension_output_layer = (output_channel: vscode.OutputChannel) =>
	Layer.succeed(ExtensionOutput, {
		append_line: (message) => Effect.sync(() => output_channel.appendLine(message)),
		show: Effect.sync(() => output_channel.show(true)),
		show_error: (message) =>
			Effect.tryPromise(() => vscode.window.showErrorMessage(message)).pipe(
				Effect.asVoid,
				Effect.ignore,
			),
		show_information: (message) =>
			Effect.tryPromise(() => vscode.window.showInformationMessage(message)).pipe(
				Effect.asVoid,
				Effect.ignore,
			),
	});
