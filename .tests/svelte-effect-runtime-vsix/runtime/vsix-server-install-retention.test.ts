import {
	PackageManagerCommandLive,
	PackageManagerInstallFiles,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/package-manager-install.ts";
import {
	make_configuration_layer,
	make_installing_command_layer,
	make_output_layer,
	vscode_configuration,
} from "./helpers/server-path.ts";
import { language_server_package_version } from "../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-package.ts";
import {
	WriteObservation,
	WritePublishedServerInstall,
	make_policy_layer,
} from "./helpers/server-install-retention.ts";
import {
	assert_equals,
	assert_false,
	assert_truthy,
} from "../../svelte-effect-runtime/unit/helpers/assert.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Option } from "effect";
import { test, vi } from "vitest";
import { join } from "node:path";

vi.mock("vscode", () => ({}));

test("VS Code extension identifies a definitely absent process", async () => {
	const { ServerInstallRetentionPolicy, ServerInstallRetentionPolicyLive } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const process_is_alive = await get_server_dispatcher().run(
		Effect.gen(function* () {
			const policy = yield* ServerInstallRetentionPolicy;

			return yield* policy.is_process_alive(2_147_483_647);
		}).pipe(Effect.provide(ServerInstallRetentionPolicyLive)),
	);

	assert_false(process_is_alive);
});

test("VS Code extension expires obsolete installs after a stable rollout grace", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const now = { value: 1_000 };
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		current_time_millis: Effect.sync(() => now.value),
		rollout_grace_millis: 1_000,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-retention-",
				});
				const obsolete_install = join(cache_root, "obsolete");
				const retention = yield* MakeServerInstallRetention(cache_root);

				yield* file_system.makeDirectory(obsolete_install, { recursive: true });
				yield* retention.cleanup(Option.none());

				const first_entries = yield* file_system.readDirectory(obsolete_install);

				yield* Effect.sync(() => {
					now.value = 1_999;
				});
				yield* retention.cleanup(Option.none());

				const second_entries = yield* file_system.readDirectory(obsolete_install);

				yield* Effect.sync(() => {
					now.value = 2_001;
				});
				yield* retention.cleanup(Option.none());

				return {
					exists_after_grace: yield* file_system.exists(obsolete_install),
					first_observation: first_entries.find((entry) =>
						entry.startsWith(".ser-observed-"),
					),
					second_observation: second_entries.find((entry) =>
						entry.startsWith(".ser-observed-"),
					),
				};
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(node_layer, make_output_layer(output_lines), policy_layer),
			),
		),
	);

	assert_false(result.exists_after_grace);
	assert_truthy(result.first_observation);
	assert_equals(result.second_observation, result.first_observation);
	assert_equals(output_lines, []);
});

test("VS Code extension protects one verified current fallback and expires its duplicate", async () => {
	const { make_server_path_resolver_layer, ServerPathResolver } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		current_time_millis: Effect.succeed(2_000),
		rollout_grace_millis: 1_000,
	});
	const application_layer = Layer.mergeAll(
		node_layer,
		make_output_layer(output_lines),
		make_configuration_layer(),
		PackageManagerCommandLive,
		Layer.succeed(PackageManagerInstallFiles, { clean: () => Effect.void }),
		policy_layer,
	);
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const storage_path = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-current-fallback-",
				});
				const cache_root = join(storage_path, "language-server", "installs");
				const protected_install = join(cache_root, language_server_package_version);
				const duplicate_install = join(
					cache_root,
					`${language_server_package_version}-duplicate`,
				);

				yield* WritePublishedServerInstall(protected_install);
				yield* WritePublishedServerInstall(duplicate_install);
				yield* WriteObservation(protected_install, 0);
				yield* WriteObservation(duplicate_install, 0);
				yield* Effect.sync(() => {
					vscode_configuration.global_path = process.execPath;
				});
				yield* Effect.gen(function* () {
					const resolver = yield* ServerPathResolver;

					yield* resolver.get;
				}).pipe(Effect.provide(make_server_path_resolver_layer(storage_path)));

				return {
					duplicate_exists: yield* file_system.exists(duplicate_install),
					protected_exists: yield* file_system.exists(protected_install),
				};
			}),
		).pipe(Effect.provide(application_layer)),
	);

	assert_truthy(result.protected_exists);
	assert_false(result.duplicate_exists);
	assert_equals(output_lines, []);
});

test("VS Code extension leases a configured server inside the managed install cache", async () => {
	const { make_server_path_resolver_layer, ServerPathResolver } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const install_attempts = { value: 0 };
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const command_layer = make_installing_command_layer(install_attempts).pipe(
		Layer.provide(node_layer),
	);
	const policy_layer = make_policy_layer({
		current_time_millis: Effect.succeed(2_000),
		rollout_grace_millis: 1_000,
	});
	const application_layer = Layer.mergeAll(
		node_layer,
		command_layer,
		make_output_layer(output_lines),
		make_configuration_layer(),
		Layer.succeed(PackageManagerInstallFiles, { clean: () => Effect.void }),
		policy_layer,
	);
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const storage_path = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-configured-managed-cache-",
				});
				const cache_root = join(storage_path, "language-server", "installs");
				const configured_install = join(cache_root, "3.9.0-configured");
				const configured_server = yield* WritePublishedServerInstall(
					configured_install,
					"3.9.0",
				);

				yield* WriteObservation(configured_install, 0);
				yield* Effect.sync(() => {
					vscode_configuration.global_path = configured_server;
				});

				const resolution = yield* Effect.gen(function* () {
					const resolver = yield* ServerPathResolver;
					const server_path = yield* resolver.get;
					const entries = yield* file_system.readDirectory(configured_install);

					return { entries, server_path };
				}).pipe(Effect.provide(make_server_path_resolver_layer(storage_path)));

				return {
					configured_exists: yield* file_system.exists(configured_install),
					configured_server,
					resolution,
				};
			}),
		).pipe(Effect.provide(application_layer)),
	);

	assert_equals(result.resolution.server_path, result.configured_server);
	assert_truthy(result.configured_exists);
	assert_truthy(result.resolution.entries.some((entry) => entry.startsWith(".ser-lease-")));
	assert_equals(install_attempts.value, 0);
	assert_equals(output_lines, []);
});

test("VS Code extension leaves the released legacy cache layout untouched", async () => {
	const { make_server_path_resolver_layer, ServerPathResolver } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		current_time_millis: Effect.succeed(20_000),
		rollout_grace_millis: 1,
	});
	const application_layer = Layer.mergeAll(
		node_layer,
		make_output_layer(output_lines),
		make_configuration_layer(),
		PackageManagerCommandLive,
		Layer.succeed(PackageManagerInstallFiles, { clean: () => Effect.void }),
		policy_layer,
	);
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const storage_path = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-legacy-cache-",
				});
				const legacy_root = join(storage_path, "language-server");
				const legacy_modules = join(legacy_root, "node_modules");
				const legacy_manifest = join(legacy_root, "package.json");

				yield* file_system.makeDirectory(legacy_modules, { recursive: true });
				yield* file_system.writeFileString(legacy_manifest, "{}\n");
				yield* file_system.writeFileString(join(legacy_root, "pnpm-lock.yaml"), "lock\n");
				yield* Effect.sync(() => {
					vscode_configuration.global_path = process.execPath;
				});
				yield* Effect.gen(function* () {
					const resolver = yield* ServerPathResolver;

					yield* resolver.get;
				}).pipe(Effect.provide(make_server_path_resolver_layer(storage_path)));

				return {
					legacy_manifest_exists: yield* file_system.exists(legacy_manifest),
					legacy_modules_exist: yield* file_system.exists(legacy_modules),
					legacy_lock_exists: yield* file_system.exists(
						join(legacy_root, "pnpm-lock.yaml"),
					),
				};
			}),
		).pipe(Effect.provide(application_layer)),
	);

	assert_truthy(result.legacy_manifest_exists);
	assert_truthy(result.legacy_modules_exist);
	assert_truthy(result.legacy_lock_exists);
	assert_equals(output_lines, []);
});

test("VS Code extension retains corrupt candidates and continues obsolete cleanup", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		current_time_millis: Effect.succeed(2_000),
		rollout_grace_millis: 1_000,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-corrupt-retention-",
				});
				const corrupt_intent_install = join(cache_root, "a-corrupt-intent");
				const corrupt_observation_install = join(cache_root, "b-corrupt-observation");
				const expired_install = join(cache_root, "c-expired");
				const retention = yield* MakeServerInstallRetention(cache_root);

				yield* file_system.makeDirectory(corrupt_intent_install, { recursive: true });
				yield* file_system.makeDirectory(corrupt_observation_install, { recursive: true });
				yield* file_system.makeDirectory(expired_install, { recursive: true });
				yield* file_system.writeFileString(
					join(corrupt_intent_install, ".ser-retire-200-corrupt.json"),
					"not-json\n",
				);
				yield* WriteObservation(corrupt_intent_install, 0);
				yield* file_system.writeFileString(
					join(corrupt_observation_install, ".ser-observed-invalid"),
					"",
				);
				yield* WriteObservation(expired_install, 0);
				yield* retention.cleanup(Option.none());

				return {
					corrupt_intent_exists: yield* file_system.exists(corrupt_intent_install),
					corrupt_observation_exists: yield* file_system.exists(
						corrupt_observation_install,
					),
					expired_exists: yield* file_system.exists(expired_install),
				};
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(node_layer, make_output_layer(output_lines), policy_layer),
			),
		),
	);

	assert_truthy(result.corrupt_intent_exists);
	assert_truthy(result.corrupt_observation_exists);
	assert_false(result.expired_exists);
	assert_truthy(output_lines.some((line) => line.includes("a-corrupt-intent")));
	assert_truthy(output_lines.some((line) => line.includes("b-corrupt-observation")));
});

test("VS Code extension reaps dead owners and conservatively retains unknown owners", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		is_process_alive: (pid) =>
			pid === 400
				? Effect.fail(new Error("process state unavailable"))
				: Effect.succeed(false),
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-owner-retention-",
				});
				const dead_intent_install = join(cache_root, "a-dead-intent");
				const dead_lease_install = join(cache_root, "b-dead-lease");
				const unknown_owner_install = join(cache_root, "c-unknown-owner");
				const expired_install = join(cache_root, "d-expired");
				const retention = yield* MakeServerInstallRetention(cache_root);

				for (const install_root of [
					dead_intent_install,
					dead_lease_install,
					unknown_owner_install,
					expired_install,
				]) {
					yield* file_system.makeDirectory(install_root, { recursive: true });
					yield* WriteObservation(install_root, 0);
				}

				yield* file_system.writeFileString(
					join(dead_intent_install, ".ser-retire-200-dead.json"),
					`${JSON.stringify({ pid: 200 })}\n`,
				);
				yield* file_system.writeFileString(
					join(dead_lease_install, ".ser-lease-300-dead.json"),
					`${JSON.stringify({ pid: 300 })}\n`,
				);
				yield* file_system.writeFileString(
					join(unknown_owner_install, ".ser-retire-400-unknown.json"),
					`${JSON.stringify({ pid: 400 })}\n`,
				);
				yield* retention.cleanup(Option.none());

				return {
					dead_intent_exists: yield* file_system.exists(dead_intent_install),
					dead_lease_exists: yield* file_system.exists(dead_lease_install),
					expired_exists: yield* file_system.exists(expired_install),
					unknown_owner_exists: yield* file_system.exists(unknown_owner_install),
				};
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(node_layer, make_output_layer(output_lines), policy_layer),
			),
		),
	);

	assert_false(result.dead_intent_exists);
	assert_false(result.dead_lease_exists);
	assert_false(result.expired_exists);
	assert_truthy(result.unknown_owner_exists);
	assert_truthy(output_lines.some((line) => line.includes("c-unknown-owner")));
});
