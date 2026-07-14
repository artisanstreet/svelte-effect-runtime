import {
	make_configuration_layer,
	make_installing_command_layer,
	make_output_layer,
	vscode_configuration,
} from "./helpers/server-path.ts";
import {
	MakeDeferredGate,
	WriteObservation,
	WritePublishedServerInstall,
	make_policy_layer,
} from "./helpers/server-install-retention.ts";
import { language_server_package_version } from "../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-package.ts";
import { PackageManagerInstallFiles } from "../../../modules/svelte-effect-runtime-vsix/src/extension/package-manager-install.ts";
import {
	assert_equals,
	assert_false,
	assert_truthy,
} from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { Effect, Exit, Fiber, FileSystem, Layer, Option, PlatformError, Ref } from "effect";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { dirname, join } from "node:path";
import { test, vi } from "vitest";

vi.mock("vscode", () => ({}));

test("VS Code extension owns one lease for the resolver scope", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer();
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-scoped-lease-",
				});
				const install_root = join(cache_root, "current");
				const server_path = yield* WritePublishedServerInstall(install_root);
				const during_scope = yield* Effect.scoped(
					Effect.gen(function* () {
						const retention = yield* MakeServerInstallRetention(cache_root);
						const first = yield* retention.ensure_lease(install_root, server_path);
						const second = yield* retention.ensure_lease(install_root, server_path);
						const entries = yield* file_system.readDirectory(install_root);

						return { entries, first, second };
					}),
				);
				const after_scope = yield* file_system.readDirectory(install_root);

				return { after_scope, during_scope };
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);
	const leases = result.during_scope.entries.filter((entry) => entry.startsWith(".ser-lease-"));

	assert_truthy(result.during_scope.first);
	assert_truthy(result.during_scope.second);
	assert_equals(leases.length, 1);
	assert_false(result.after_scope.some((entry) => entry.startsWith(".ser-lease-")));
});

test("VS Code extension replaces stale in-memory lease ownership after path reuse", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer();
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-stale-lease-ownership-",
				});
				const install_root = join(cache_root, "current");
				const moved_root = join(cache_root, "moved-current");
				const first_server_path = yield* WritePublishedServerInstall(install_root);
				const retention = yield* MakeServerInstallRetention(cache_root);

				yield* retention.ensure_lease(install_root, first_server_path);

				const first_entries = yield* file_system.readDirectory(install_root);
				const first_lease = first_entries.find((entry) => entry.startsWith(".ser-lease-"));

				yield* file_system.rename(install_root, moved_root);

				const second_server_path = yield* WritePublishedServerInstall(install_root);
				const second_created = yield* retention.ensure_lease(
					install_root,
					second_server_path,
				);
				const second_entries = yield* file_system.readDirectory(install_root);
				const second_lease = second_entries.find((entry) =>
					entry.startsWith(".ser-lease-"),
				);

				return { first_lease, second_created, second_lease };
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);

	assert_truthy(result.first_lease);
	assert_truthy(result.second_created);
	assert_truthy(result.second_lease);
	assert_false(result.second_lease === result.first_lease);
});

test("VS Code extension propagates persistent lease publication failures", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const blocked_install = { value: "" };
	const file_system_layer = Layer.effect(
		FileSystem.FileSystem,
		Effect.gen(function* () {
			const file_system = yield* FileSystem.FileSystem;

			return FileSystem.makeNoop({
				...file_system,
				makeTempFile: (options) =>
					options?.directory === blocked_install.value
						? Effect.fail(
								PlatformError.systemError({
									_tag: "PermissionDenied",
									method: "makeTempFile",
									module: "FileSystem",
									pathOrDescriptor: blocked_install.value,
								}),
							)
						: file_system.makeTempFile(options),
			});
		}),
	).pipe(Layer.provide(NodeFileSystem.layer));
	const policy_layer = make_policy_layer();
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-lease-permission-",
				});
				const install_root = join(cache_root, "current");
				const server_path = yield* WritePublishedServerInstall(install_root);
				const retention = yield* MakeServerInstallRetention(cache_root);

				yield* Effect.sync(() => {
					blocked_install.value = install_root;
				});

				return yield* Effect.exit(retention.ensure_lease(install_root, server_path));
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

	assert_truthy(Exit.isFailure(result));
});

test("VS Code extension rejects a lease after observing a live intent that disappears", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const remove_live_intent = await get_server_dispatcher().run(
		Ref.make<Effect.Effect<void, unknown>>(Effect.void),
	);
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		is_process_alive: (pid) =>
			Ref.get(remove_live_intent).pipe(
				Effect.flatMap((remove_intent) => remove_intent),
				Effect.as(pid === 200),
			),
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-disappearing-live-intent-",
				});
				const install_root = join(cache_root, "current");
				const intent_path = join(install_root, ".ser-retire-200-live.json");
				const server_path = yield* WritePublishedServerInstall(install_root);
				const retention = yield* MakeServerInstallRetention(cache_root);

				yield* file_system.writeFileString(
					intent_path,
					`${JSON.stringify({ pid: 200 })}\n`,
				);
				yield* Ref.set(
					remove_live_intent,
					file_system.remove(intent_path, { force: true }),
				);

				const lease_created = yield* retention.ensure_lease(install_root, server_path);
				const entries = yield* file_system.readDirectory(install_root);

				return {
					intent_exists: yield* file_system.exists(intent_path),
					lease_created,
					lease_exists: entries.some((entry) => entry.startsWith(".ser-lease-")),
				};
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);

	assert_false(result.intent_exists);
	assert_false(result.lease_created);
	assert_false(result.lease_exists);
});

test("VS Code extension re-resolves when cleanup wins before lease publication", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const [precheck_reached, release_precheck] = await get_server_dispatcher().run(
		Effect.all([MakeDeferredGate, MakeDeferredGate]),
	);
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		on_transition: (transition) =>
			transition._tag === "LeasePrecheckComplete"
				? precheck_reached.open.pipe(Effect.andThen(release_precheck.await_open))
				: Effect.void,
		rollout_grace_millis: 1_000,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-cleanup-wins-",
				});
				const install_root = join(cache_root, "obsolete");
				const server_path = yield* WritePublishedServerInstall(install_root);
				const leaser = yield* MakeServerInstallRetention(cache_root);
				const cleaner = yield* MakeServerInstallRetention(cache_root);

				yield* WriteObservation(install_root, 0);

				const lease_fiber = yield* Effect.forkChild(
					leaser.ensure_lease(install_root, server_path),
				);

				yield* precheck_reached.await_open;
				yield* cleaner.cleanup(Option.none());
				yield* release_precheck.open;

				return {
					install_exists: yield* file_system.exists(install_root),
					lease_created: yield* Fiber.join(lease_fiber),
				};
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);
	assert_false(result.install_exists);
	assert_false(result.lease_created);
});

test("VS Code extension rolls back a lease when retirement starts after its precheck", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const [precheck_reached, release_precheck] = await get_server_dispatcher().run(
		Effect.all([MakeDeferredGate, MakeDeferredGate]),
	);
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		is_process_alive: (pid) => Effect.succeed(pid === 200),
		on_transition: (transition) =>
			transition._tag === "LeasePrecheckComplete"
				? precheck_reached.open.pipe(Effect.andThen(release_precheck.await_open))
				: Effect.void,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-intent-after-precheck-",
				});
				const install_root = join(cache_root, "current");
				const server_path = yield* WritePublishedServerInstall(install_root);
				const retention = yield* MakeServerInstallRetention(cache_root);
				const lease_fiber = yield* Effect.forkChild(
					retention.ensure_lease(install_root, server_path),
				);

				yield* precheck_reached.await_open;
				yield* file_system.writeFileString(
					join(install_root, ".ser-retire-200-race.json"),
					`${JSON.stringify({ pid: 200 })}\n`,
				);
				yield* release_precheck.open;

				const lease_created = yield* Fiber.join(lease_fiber);
				const entries = yield* file_system.readDirectory(install_root);

				return { entries, lease_created };
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);

	assert_false(result.lease_created);
	assert_false(result.entries.some((entry) => entry.startsWith(".ser-lease-")));
});

test("VS Code extension rejects a lease when retirement finishes during intent validation", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const [precheck_reached, release_precheck] = await get_server_dispatcher().run(
		Effect.all([MakeDeferredGate, MakeDeferredGate]),
	);
	const retire_install = await get_server_dispatcher().run(
		Ref.make<Effect.Effect<void, unknown>>(Effect.void),
	);
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		is_process_alive: () =>
			Ref.get(retire_install).pipe(
				Effect.flatMap((retire) => retire),
				Effect.as(false),
			),
		on_transition: (transition) =>
			transition._tag === "LeasePrecheckComplete"
				? precheck_reached.open.pipe(Effect.andThen(release_precheck.await_open))
				: Effect.void,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-retired-during-intent-check-",
				});
				const install_root = join(cache_root, "current");
				const retired_root = join(cache_root, "retired");
				const server_path = yield* WritePublishedServerInstall(install_root);
				const retention = yield* MakeServerInstallRetention(cache_root);
				const lease_fiber = yield* Effect.forkChild(
					retention.ensure_lease(install_root, server_path),
				);

				yield* precheck_reached.await_open;
				yield* file_system.writeFileString(
					join(install_root, ".ser-retire-200-race.json"),
					`${JSON.stringify({ pid: 200 })}\n`,
				);
				yield* Ref.set(retire_install, file_system.rename(install_root, retired_root));
				yield* release_precheck.open;

				const lease_created = yield* Fiber.join(lease_fiber);

				return {
					install_exists: yield* file_system.exists(install_root),
					lease_created,
					retired_exists: yield* file_system.exists(retired_root),
				};
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);

	assert_false(result.install_exists);
	assert_false(result.lease_created);
	assert_truthy(result.retired_exists);
});

test("VS Code extension preserves an install when lease publication wins", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const [lease_published, release_lease] = await get_server_dispatcher().run(
		Effect.all([MakeDeferredGate, MakeDeferredGate]),
	);
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		is_process_alive: (pid) => Effect.succeed(pid === 100),
		on_transition: (transition) =>
			transition._tag === "LeasePublished"
				? lease_published.open.pipe(Effect.andThen(release_lease.await_open))
				: Effect.void,
		rollout_grace_millis: 1_000,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-lease-wins-",
				});
				const install_root = join(cache_root, "obsolete");
				const server_path = yield* WritePublishedServerInstall(install_root);
				const leaser = yield* MakeServerInstallRetention(cache_root);
				const cleaner = yield* MakeServerInstallRetention(cache_root);

				yield* WriteObservation(install_root, 0);

				const lease_fiber = yield* Effect.forkChild(
					leaser.ensure_lease(install_root, server_path),
				);

				yield* lease_published.await_open;
				yield* cleaner.cleanup(Option.none());
				yield* release_lease.open;

				return {
					install_exists: yield* file_system.exists(install_root),
					lease_created: yield* Fiber.join(lease_fiber),
				};
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);

	assert_truthy(result.install_exists);
	assert_truthy(result.lease_created);
});

test("VS Code extension rejects a published lease after install path reuse", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const [lease_published, release_lease] = await get_server_dispatcher().run(
		Effect.all([MakeDeferredGate, MakeDeferredGate]),
	);
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		on_transition: (transition) =>
			transition._tag === "LeasePublished"
				? lease_published.open.pipe(Effect.andThen(release_lease.await_open))
				: Effect.void,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-install-path-reuse-",
				});
				const install_root = join(cache_root, "current");
				const moved_root = join(cache_root, "moved-current");
				const server_path = yield* WritePublishedServerInstall(install_root);
				const retention = yield* MakeServerInstallRetention(cache_root);
				const lease_fiber = yield* Effect.forkChild(
					retention.ensure_lease(install_root, server_path),
				);

				yield* lease_published.await_open;
				yield* file_system.rename(install_root, moved_root);
				yield* WritePublishedServerInstall(install_root);
				yield* release_lease.open;

				const lease_created = yield* Fiber.join(lease_fiber);
				const replacement_entries = yield* file_system.readDirectory(install_root);

				return { lease_created, replacement_entries };
			}),
		).pipe(Effect.provide(Layer.mergeAll(node_layer, make_output_layer([]), policy_layer))),
	);

	assert_false(result.lease_created);
	assert_false(result.replacement_entries.some((entry) => entry.startsWith(".ser-lease-")));
});

test("VS Code extension skips live retirement intents and publishes a replacement", async () => {
	const { make_server_path_resolver_layer, ServerPathResolver } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const install_attempts = { value: 0 };
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const command_layer = make_installing_command_layer(install_attempts).pipe(
		Layer.provide(node_layer),
	);
	const policy_layer = make_policy_layer({
		is_process_alive: (pid) => Effect.succeed(pid === 100 || pid === 200),
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
					prefix: "ser-vsix-live-intent-",
				});
				const install_root = join(
					storage_path,
					"language-server",
					"installs",
					language_server_package_version,
				);

				yield* WritePublishedServerInstall(install_root);
				yield* file_system.writeFileString(
					join(install_root, ".ser-retire-200-live.json"),
					`${JSON.stringify({ pid: 200 })}\n`,
				);
				yield* Effect.sync(() => {
					vscode_configuration.global_path = undefined;
				});

				const server_path = yield* Effect.gen(function* () {
					const resolver = yield* ServerPathResolver;

					return yield* resolver.get;
				}).pipe(Effect.provide(make_server_path_resolver_layer(storage_path)));

				return {
					install_exists: yield* file_system.exists(install_root),
					original_install: install_root,
					resolved_install: dirname(dirname(dirname(dirname(server_path)))),
				};
			}),
		).pipe(Effect.provide(application_layer)),
	);

	assert_equals(install_attempts.value, 1);
	assert_truthy(result.install_exists);
	assert_false(result.resolved_install === result.original_install);
});

test("VS Code extension lets two cleaners converge on one install retirement", async () => {
	const { MakeServerInstallRetention } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts");
	const synchronization = await get_server_dispatcher().run(
		Effect.all({
			both_cleaners_ready: MakeDeferredGate,
			ready_cleaners: Ref.make(0),
			release_cleaners: MakeDeferredGate,
		}),
	);
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const policy_layer = make_policy_layer({
		on_transition: (transition) =>
			transition._tag === "RetireReady"
				? Ref.updateAndGet(synchronization.ready_cleaners, (ready) => ready + 1).pipe(
						Effect.tap((ready) =>
							ready === 2 ? synchronization.both_cleaners_ready.open : Effect.void,
						),
						Effect.andThen(synchronization.release_cleaners.await_open),
					)
				: Effect.void,
		rollout_grace_millis: 1_000,
	});
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const cache_root = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-competing-cleaners-",
				});
				const install_root = join(cache_root, "obsolete");
				const first_cleaner = yield* MakeServerInstallRetention(cache_root);
				const second_cleaner = yield* MakeServerInstallRetention(cache_root);

				yield* file_system.makeDirectory(install_root, { recursive: true });
				yield* WriteObservation(install_root, 0);

				const first_fiber = yield* Effect.forkChild(first_cleaner.cleanup(Option.none()));
				const second_fiber = yield* Effect.forkChild(second_cleaner.cleanup(Option.none()));

				yield* synchronization.both_cleaners_ready.await_open;
				yield* synchronization.release_cleaners.open;
				yield* Fiber.join(first_fiber);
				yield* Fiber.join(second_fiber);

				return yield* file_system.exists(install_root);
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(node_layer, make_output_layer(output_lines), policy_layer),
			),
		),
	);

	assert_false(result);
	assert_equals(output_lines, []);
});
