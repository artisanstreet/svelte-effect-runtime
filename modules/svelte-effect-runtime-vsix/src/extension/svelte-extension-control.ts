import { svelte_extension_id } from "./constants.ts";
import { Context, Effect, Layer } from "effect";

import * as vscode from "vscode";

export class SvelteExtensionControl extends Context.Service<
	SvelteExtensionControl,
	{
		readonly available: Effect.Effect<boolean>;
		readonly restart: Effect.Effect<boolean, unknown>;
	}
>()("svelte-effect-runtime-vsix/SvelteExtensionControl") {}

export const SvelteExtensionControlLive = Layer.succeed(SvelteExtensionControl, {
	available: Effect.sync(() => vscode.extensions.getExtension(svelte_extension_id) !== undefined),
	restart: Effect.gen(function* () {
		const commands = yield* Effect.tryPromise(() => vscode.commands.getCommands(true));

		if (!commands.includes("svelte.restartLanguageServer")) {
			return false;
		}

		yield* Effect.tryPromise(() =>
			vscode.commands.executeCommand("svelte.restartLanguageServer"),
		);

		return true;
	}),
});
