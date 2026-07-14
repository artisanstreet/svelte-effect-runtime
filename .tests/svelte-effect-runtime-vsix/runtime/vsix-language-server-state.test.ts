import {
	configuration_snapshots_equal,
	resolve_language_server_client_target,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-state.ts";
import {
	LanguageServerCoordinator,
	LanguageServerCoordinatorLive,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-coordinator.ts";
import {
	ExtensionOutput,
	ExtensionState,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/extension-services.ts";
import { SvelteExtensionControl } from "../../../modules/svelte-effect-runtime-vsix/src/extension/svelte-extension-control.ts";
import { LanguageClientControl } from "../../../modules/svelte-effect-runtime-vsix/src/extension/client-control.ts";
import { ExtensionConfiguration } from "../../../modules/svelte-effect-runtime-vsix/src/extension/settings.ts";
import { ServerPathResolver } from "../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { assert_equals, assert_false } from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { test, vi } from "vitest";

vi.mock("vscode", () => ({}));

test("VS Code extension invalidates cached auto mode when Svelte becomes available", () => {
	const unavailable = make_snapshot(false);
	const available = make_snapshot(true);

	assert_false(configuration_snapshots_equal(unavailable, available));
	assert_equals(resolve_language_server_client_target(unavailable), "direct");
	assert_equals(resolve_language_server_client_target(available), "svelteExtension");
});

test("VS Code coordinator reconciles auto mode when Svelte becomes available", async () => {
	const availability = { value: false };
	const client_starts: string[] = [];
	const client_stops = { value: 0 };
	const delegated_paths: Array<string | undefined> = [];
	const delegated_restarts = { value: 0 };
	const enabled = { value: true };
	const server_path = process.execPath;
	const dependencies = Layer.mergeAll(
		NodeFileSystem.layer,
		Layer.succeed(ExtensionConfiguration, {
			get_client_mode: Effect.succeed("auto" as const),
			get_enabled: Effect.sync(() => enabled.value),
			inspect_runtime_server_path: Effect.succeed({}),
			inspect_svelte_server_path: Effect.sync(() => ({
				global_path: delegated_paths.at(-1),
			})),
			set_enabled: (next_enabled: boolean) =>
				Effect.sync(() => {
					enabled.value = next_enabled;
				}),
			write_svelte_server_path: (path: string | undefined) =>
				Effect.sync(() => {
					delegated_paths.push(path);
				}),
		}),
		Layer.succeed(ExtensionState, {
			read_path: () => Effect.succeed(Option.none()),
			write_path: () => Effect.void,
		}),
		Layer.succeed(ExtensionOutput, {
			append_line: () => Effect.void,
			show: Effect.void,
			show_error: () => Effect.void,
			show_information: () => Effect.void,
		}),
		Layer.succeed(SvelteExtensionControl, {
			available: Effect.sync(() => availability.value),
			restart: Effect.sync(() => {
				delegated_restarts.value += 1;

				return true;
			}),
		}),
		Layer.succeed(LanguageClientControl, {
			start: (path: string) =>
				Effect.sync(() => {
					client_starts.push(path);
				}),
			stop: Effect.sync(() => {
				client_stops.value += 1;
			}),
		}),
		Layer.succeed(ServerPathResolver, {
			get: Effect.succeed(server_path),
		}),
	);
	const coordinator_layer = LanguageServerCoordinatorLive.pipe(Layer.provide(dependencies));
	const Program = Effect.gen(function* () {
		const coordinator = yield* LanguageServerCoordinator;
		const first_state = yield* coordinator.sync;

		yield* Effect.sync(() => {
			availability.value = true;
		});
		yield* coordinator.start;

		return first_state;
	}).pipe(Effect.provide(coordinator_layer));
	const first_state = await get_server_dispatcher().run(Program);

	assert_equals(first_state, "direct");
	assert_equals(client_starts, [server_path]);
	assert_equals(client_stops.value, 1);
	assert_equals(delegated_paths.at(-1), server_path);
	assert_equals(delegated_restarts.value, 1);
});

function make_snapshot(svelte_extension_available: boolean) {
	return {
		client_mode: "auto" as const,
		enabled: true,
		global_path: undefined,
		svelte_extension_available,
		workspace_folder_language_path: undefined,
		workspace_folder_path: undefined,
		workspace_language_path: undefined,
		workspace_path: undefined,
	};
}
