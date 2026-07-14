import {
	PackageManagerCommand,
	type CommandInvocation,
} from "../../../../modules/svelte-effect-runtime-vsix/src/extension/package-manager-install.ts";
import { ExtensionOutput } from "../../../../modules/svelte-effect-runtime-vsix/src/extension/extension-services.ts";
import { ExtensionConfiguration } from "../../../../modules/svelte-effect-runtime-vsix/src/extension/settings.ts";
import { WritePublishedServerInstall } from "./server-install-retention.ts";
import { Effect, FileSystem, Layer } from "effect";

export const vscode_configuration: { global_path: unknown } = {
	global_path: undefined,
};

export function make_output_layer(output_lines: string[]) {
	return Layer.succeed(ExtensionOutput, {
		append_line: (message: string) =>
			Effect.sync(() => {
				output_lines.push(message);
			}),
		show: Effect.void,
		show_error: () => Effect.void,
		show_information: () => Effect.void,
	});
}

export function make_configuration_layer() {
	return Layer.succeed(ExtensionConfiguration, {
		get_client_mode: Effect.succeed("auto" as const),
		get_enabled: Effect.succeed(true),
		inspect_runtime_server_path: Effect.sync(() => ({
			global_path: vscode_configuration.global_path,
		})),
		inspect_svelte_server_path: Effect.succeed({}),
		set_enabled: () => Effect.void,
		write_svelte_server_path: () => Effect.void,
	});
}

export function make_installing_command_layer(
	install_attempts: { value: number },
	install_delay_ms = 0,
) {
	return Layer.effect(
		PackageManagerCommand,
		Effect.gen(function* () {
			const file_system = yield* FileSystem.FileSystem;

			return {
				run: (invocation: CommandInvocation, cwd?: string) =>
					Effect.gen(function* () {
						if (invocation.args.includes("install") && cwd) {
							yield* Effect.sync(() => {
								install_attempts.value += 1;
							});

							if (install_delay_ms > 0) {
								yield* Effect.sleep(`${install_delay_ms} millis`);
							}

							yield* WritePublishedServerInstall(cwd).pipe(
								Effect.provideService(FileSystem.FileSystem, file_system),
							);
						}

						return { stdout: "1.0.0", stderr: "" };
					}),
			};
		}),
	);
}
