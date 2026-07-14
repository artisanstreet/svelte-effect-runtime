import {
	legacy_state_managed_path,
	legacy_state_previous_path,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/constants.ts";
import {
	ExtensionState,
	make_extension_state_layer,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/extension-services.ts";
import {
	assert_equals,
	assert_false,
	assert_truthy,
} from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import { ExtensionConfiguration } from "../../../modules/svelte-effect-runtime-vsix/src/extension/settings.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { Effect, Exit, FileSystem, Layer, Option } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { test, vi } from "vitest";
import { join } from "node:path";

vi.mock("vscode", () => ({}));

const svelte_configuration: {
	fail_update_to: unknown;
	global_path: unknown;
	should_fail_update: boolean;
	update_attempts: unknown[];
} = {
	fail_update_to: undefined,
	global_path: undefined,
	should_fail_update: false,
	update_attempts: [],
};

test("VS Code extension migrates a blank managed legacy server path", async () => {
	const { MigrateLegacySvelteConfiguration } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/svelte-extension-config.ts");
	const legacy_server_path = join(process.cwd(), ".dist", "server.js");

	svelte_configuration.global_path = legacy_server_path;

	for (const blank_path of ["", " \t "]) {
		const global_state = new Map<string, unknown>([[legacy_state_managed_path, blank_path]]);
		const state_layer = make_extension_state_layer({
			get: (key: string) => global_state.get(key),
			update: (key: string, value: unknown) => {
				global_state.set(key, value);

				return Promise.resolve();
			},
		});

		await get_server_dispatcher().run(
			MigrateLegacySvelteConfiguration(legacy_server_path).pipe(
				Effect.provide(Layer.merge(state_layer, make_configuration_layer())),
			),
		);

		assert_equals(global_state.get(legacy_state_managed_path), legacy_server_path);
	}
});

test("VS Code extension compensates failed delegated configuration writes", async () => {
	const { ConfigureSvelteExtensionLanguageServer } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/svelte-extension-config.ts");
	const global_state = new Map<string, unknown>();
	const fail_managed_update = { value: true };
	const state_layer = Layer.succeed(ExtensionState, {
		read_path: (key: string) => Effect.succeed(read_test_path(global_state, key)),
		write_path: (key: string, value: string | undefined) =>
			Effect.tryPromise(() => {
				if (key === legacy_state_managed_path && fail_managed_update.value) {
					fail_managed_update.value = false;

					return Promise.reject(new Error("state write failed"));
				}

				if (value === undefined) {
					global_state.delete(key);
				} else {
					global_state.set(key, value);
				}

				return Promise.resolve();
			}),
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const temp_directory = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-svelte-config-",
				});
				const previous_path = join(temp_directory, "previous-server.cjs");
				const server_path = join(temp_directory, "ser-server.cjs");

				yield* file_system.writeFileString(previous_path, "module.exports = {};\n");
				yield* file_system.writeFileString(server_path, "module.exports = {};\n");
				yield* Effect.sync(() => {
					svelte_configuration.global_path = previous_path;
					svelte_configuration.should_fail_update = false;
					svelte_configuration.update_attempts = [];
				});

				const configure_exit = yield* Effect.exit(
					ConfigureSvelteExtensionLanguageServer(server_path, { force: true }),
				);

				return { configure_exit, previous_path };
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(NodeFileSystem.layer, state_layer, make_configuration_layer()),
			),
		),
	);

	assert_truthy(Exit.isFailure(result.configure_exit));
	assert_equals(svelte_configuration.global_path, result.previous_path);
	assert_false(global_state.has(legacy_state_managed_path));
	assert_false(global_state.has(legacy_state_previous_path));
});

test("VS Code extension continues compensation after the first rollback fails", async () => {
	const { ConfigureSvelteExtensionLanguageServer } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/svelte-extension-config.ts");
	const global_state = new Map<string, unknown>();
	const fail_managed_update = { value: true };
	const state_layer = Layer.succeed(ExtensionState, {
		read_path: (key: string) => Effect.succeed(read_test_path(global_state, key)),
		write_path: (key: string, value: string | undefined) =>
			Effect.tryPromise(() => {
				if (key === legacy_state_managed_path && fail_managed_update.value) {
					fail_managed_update.value = false;

					return Promise.reject(new Error("state write failed"));
				}

				if (value === undefined) {
					global_state.delete(key);
				} else {
					global_state.set(key, value);
				}

				return Promise.resolve();
			}),
	});
	const Program = Effect.scoped(
		Effect.gen(function* () {
			const file_system = yield* FileSystem.FileSystem;
			const temp_directory = yield* file_system.makeTempDirectoryScoped({
				prefix: "ser-vsix-svelte-rollback-",
			});
			const previous_path = join(temp_directory, "previous-server.cjs");
			const server_path = join(temp_directory, "ser-server.cjs");

			yield* file_system.writeFileString(previous_path, "module.exports = {};\n");
			yield* file_system.writeFileString(server_path, "module.exports = {};\n");
			yield* Effect.sync(() => {
				svelte_configuration.global_path = previous_path;
				svelte_configuration.fail_update_to = previous_path;
				svelte_configuration.should_fail_update = true;
				svelte_configuration.update_attempts = [];
			});

			const configure_exit = yield* Effect.exit(
				ConfigureSvelteExtensionLanguageServer(server_path, { force: true }),
			);

			return { configure_exit, previous_path, server_path };
		}),
	).pipe(
		Effect.provide(
			Layer.mergeAll(NodeFileSystem.layer, state_layer, make_configuration_layer()),
		),
	);
	const result = await get_server_dispatcher().run(Program);

	assert_truthy(Exit.isFailure(result.configure_exit));
	assert_equals(svelte_configuration.global_path, result.server_path);
	assert_truthy(svelte_configuration.update_attempts.includes(result.previous_path));
	assert_false(global_state.has(legacy_state_managed_path));
	assert_false(global_state.has(legacy_state_previous_path));
});

function read_test_path(global_state: Map<string, unknown>, key: string) {
	const value = global_state.get(key);

	return typeof value === "string" && value.trim().length > 0
		? Option.some(value)
		: Option.none<string>();
}

function make_configuration_layer() {
	return Layer.succeed(ExtensionConfiguration, {
		get_client_mode: Effect.succeed("auto" as const),
		get_enabled: Effect.succeed(true),
		inspect_runtime_server_path: Effect.succeed({}),
		inspect_svelte_server_path: Effect.sync(() => ({
			global_path: svelte_configuration.global_path,
		})),
		set_enabled: () => Effect.void,
		write_svelte_server_path: (value: string | undefined) =>
			Effect.gen(function* () {
				yield* Effect.sync(() => {
					svelte_configuration.update_attempts.push(value);
				});

				if (
					svelte_configuration.should_fail_update &&
					Object.is(value, svelte_configuration.fail_update_to)
				) {
					svelte_configuration.should_fail_update = false;

					return yield* Effect.fail(new Error("configuration rollback failed"));
				}

				yield* Effect.sync(() => {
					svelte_configuration.global_path = value;
				});
			}),
	});
}
