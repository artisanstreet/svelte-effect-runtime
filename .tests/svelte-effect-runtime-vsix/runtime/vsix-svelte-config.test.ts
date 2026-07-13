import {
	legacy_state_managed_path,
	legacy_state_previous_path,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/constants.ts";
import {
	assert_equals,
	assert_false,
	assert_truthy,
} from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, FileSystem } from "effect";
import { test, vi } from "vitest";
import { join } from "node:path";

const svelte_configuration: {
	fail_update_to: unknown;
	global_path: unknown;
	should_fail_update: boolean;
	update_attempts: unknown[];
} = vi.hoisted(() => ({
	fail_update_to: undefined,
	global_path: undefined,
	should_fail_update: false,
	update_attempts: [],
}));

vi.mock("vscode", () => ({
	ConfigurationTarget: { Global: 1 },
	workspace: {
		getConfiguration: () => ({
			inspect: () => ({
				globalValue: svelte_configuration.global_path,
			}),
			update: (_key: string, value: unknown) => {
				svelte_configuration.update_attempts.push(value);

				if (
					svelte_configuration.should_fail_update &&
					Object.is(value, svelte_configuration.fail_update_to)
				) {
					svelte_configuration.should_fail_update = false;

					return Promise.reject(new Error("configuration rollback failed"));
				}

				svelte_configuration.global_path = value;

				return Promise.resolve();
			},
		}),
	},
}));

test("VS Code extension compensates failed delegated configuration writes", async () => {
	const { ConfigureSvelteExtensionLanguageServer } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/svelte-extension-config.ts");
	const global_state = new Map<string, unknown>();
	const fail_managed_update = { value: true };
	const context = {
		globalState: {
			get: (key: string) => global_state.get(key),
			update: (key: string, value: unknown) => {
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
			},
		},
	};
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
					ConfigureSvelteExtensionLanguageServer(context, server_path, { force: true }),
				);

				return { configure_exit, previous_path };
			}),
		).pipe(Effect.provide(NodeFileSystem.layer)),
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
	const context = {
		globalState: {
			get: (key: string) => global_state.get(key),
			update: (key: string, value: unknown) => {
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
			},
		},
	};
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
				ConfigureSvelteExtensionLanguageServer(context, server_path, { force: true }),
			);

			return { configure_exit, previous_path, server_path };
		}),
	).pipe(Effect.provide(NodeFileSystem.layer));
	const result = await get_server_dispatcher().run(Program);

	assert_truthy(Exit.isFailure(result.configure_exit));
	assert_equals(svelte_configuration.global_path, result.server_path);
	assert_truthy(svelte_configuration.update_attempts.includes(result.previous_path));
	assert_false(global_state.has(legacy_state_managed_path));
	assert_false(global_state.has(legacy_state_previous_path));
});
