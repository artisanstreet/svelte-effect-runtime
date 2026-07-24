import { language_server_package_version } from "../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-package.ts";
import {
	assert_equals,
	assert_false,
	assert_truthy,
} from "../../svelte-effect-runtime/unit/helpers/assert.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { WriteStagingOwner, make_policy_layer } from "./helpers/server-install-retention.ts";
import { Effect, FileSystem, Layer, Option, PlatformError } from "effect";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { make_output_layer } from "./helpers/server-path.ts";
import { basename, join } from "node:path";
import { utimes } from "node:fs/promises";
import { test, vi } from "vitest";

vi.mock("vscode", () => ({}));

test("VS Code extension gives every staging install a non-reusable generation", async () => {
	const { MakeServerInstallStaging } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const generations = [
		"00000000-0000-4000-8000-000000000001",
		"00000000-0000-4000-8000-000000000002",
	];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		next_generation: Effect.sync(() => generations.shift() ?? "missing-generation"),
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-staging-generation-",
				});
				const first = yield* MakeServerInstallStaging(
					cache_root,
					language_server_package_version,
				);
				const second = yield* MakeServerInstallStaging(
					cache_root,
					language_server_package_version,
				);

				return {
					first: basename(first.root),
					first_identity: first.install_identity,
					second: basename(second.root),
					second_identity: second.install_identity,
				};
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);
	const generation_pattern = /^\.ser-stage-100-[0-9a-f-]{36}-/;

	assert_false(result.first === result.second);
	assert_false(result.first_identity === result.second_identity);
	assert_truthy(generation_pattern.test(result.first));
	assert_truthy(generation_pattern.test(result.second));
});

test("VS Code extension retries an abandoned staging removal while its owner is alive", async () => {
	const { MakeServerInstallRetention, MakeServerInstallStaging } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const blocked_staging = { value: "" };
	const fail_removal = { value: true };
	const file_system_layer = Layer.effect(
		FileSystem.FileSystem,
		Effect.gen(function* () {
			const file_system = yield* FileSystem.FileSystem;

			return FileSystem.makeNoop({
				...file_system,
				remove: (path, options) => {
					if (path !== blocked_staging.value || !fail_removal.value) {
						return file_system.remove(path, options);
					}

					fail_removal.value = false;

					return Effect.fail(
						PlatformError.systemError({
							_tag: "Busy",
							method: "remove",
							module: "FileSystem",
							pathOrDescriptor: path,
						}),
					);
				},
			});
		}),
	).pipe(Layer.provide(NodeFileSystem.layer));
	const policy_layer = make_policy_layer();
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-abandoned-staging-",
				});
				const staging_root = yield* Effect.scoped(
					Effect.gen(function* () {
						const staging = yield* MakeServerInstallStaging(
							cache_root,
							language_server_package_version,
						);

						yield* Effect.sync(() => {
							blocked_staging.value = staging.root;
						});

						return staging.root;
					}),
				);
				const abandoned_marker = join(staging_root, ".ser-staging-abandoned");
				const marker_exists_after_release = yield* file_system.exists(abandoned_marker);
				const staging_exists_after_release = yield* file_system.exists(staging_root);
				const retention = yield* MakeServerInstallRetention(cache_root);

				yield* retention.cleanup(Option.none());

				return {
					marker_exists_after_release,
					staging_exists_after_cleanup: yield* file_system.exists(staging_root),
					staging_exists_after_release,
				};
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(
					file_system_layer,
					NodePath.layer,
					make_output_layer([]),
					policy_layer,
				),
			),
		),
	);

	assert_truthy(result.marker_exists_after_release);
	assert_truthy(result.staging_exists_after_release);
	assert_false(result.staging_exists_after_cleanup);
});

test("VS Code extension removes dead staging installs and retains live ones", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		current_time_millis: Effect.succeed(2_000),
		is_process_alive: (pid) => Effect.succeed(pid === 300),
		rollout_grace_millis: 1_000,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-staging-retention-",
				});
				const dead_staging = join(cache_root, ".ser-stage-200-dead-generation-4.0.0-dead");
				const live_staging = join(cache_root, ".ser-stage-300-live-generation-4.0.0-live");
				const legacy_staging = join(
					cache_root,
					"4.0.1-.ser-stage-400-legacy-generation-4.0.1-dead",
				);
				const retention = yield* MakeServerInstallRetention(cache_root);

				yield* WriteStagingOwner(dead_staging, 200, "dead-generation", 0);
				yield* WriteStagingOwner(live_staging, 300, "live-generation", 0);
				yield* WriteStagingOwner(legacy_staging, 400, "legacy-generation", 0);
				yield* retention.cleanup(Option.none());

				return {
					dead_exists: yield* file_system.exists(dead_staging),
					legacy_exists: yield* file_system.exists(legacy_staging),
					live_exists: yield* file_system.exists(live_staging),
				};
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(node_layer, make_output_layer(output_lines), policy_layer),
			),
		),
	);

	assert_false(result.dead_exists);
	assert_false(result.legacy_exists);
	assert_truthy(result.live_exists);
	assert_equals(output_lines, []);
});

test("VS Code extension recovers staging age from the directory when owner metadata is incomplete", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		current_time_millis: Effect.succeed(2_000),
		is_process_alive: (pid) =>
			pid === 400
				? Effect.fail(new Error("process state unavailable"))
				: Effect.succeed(false),
		rollout_grace_millis: 1_000,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-staging-fallback-",
				});
				const missing_owner = join(cache_root, ".ser-stage-200-4.0.0-missing");
				const corrupt_owner = join(cache_root, ".ser-stage-300-4.0.0-corrupt");
				const unknown_owner = join(cache_root, ".ser-stage-400-4.0.0-unknown");
				const untrustworthy_owner = join(cache_root, ".ser-stage-invalid-owner");
				const retention = yield* MakeServerInstallRetention(cache_root);

				for (const staging_root of [
					missing_owner,
					corrupt_owner,
					unknown_owner,
					untrustworthy_owner,
				]) {
					yield* file_system.makeDirectory(staging_root, { recursive: true });
				}

				yield* file_system.writeFileString(
					join(corrupt_owner, ".ser-install-generation.json"),
					"not-json\n",
				);

				for (const staging_root of [
					missing_owner,
					corrupt_owner,
					unknown_owner,
					untrustworthy_owner,
				]) {
					yield* Effect.tryPromise(() => utimes(staging_root, new Date(0), new Date(0)));
				}

				yield* retention.cleanup(Option.none());

				return {
					corrupt_exists: yield* file_system.exists(corrupt_owner),
					missing_exists: yield* file_system.exists(missing_owner),
					unknown_exists: yield* file_system.exists(unknown_owner),
					untrustworthy_exists: yield* file_system.exists(untrustworthy_owner),
				};
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(node_layer, make_output_layer(output_lines), policy_layer),
			),
		),
	);

	assert_false(result.missing_exists);
	assert_false(result.corrupt_exists);
	assert_truthy(result.unknown_exists);
	assert_truthy(result.untrustworthy_exists);
	assert_truthy(output_lines.some((line) => line.includes(".ser-stage-400-")));
	assert_truthy(output_lines.some((line) => line.includes(".ser-stage-invalid-owner")));
});
