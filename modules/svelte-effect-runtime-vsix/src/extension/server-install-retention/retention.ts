import {
	HasLiveServerInstallLease,
	MakeServerInstallLeaseManager,
	PublishServerInstallRetireIntent,
	ReapDeadServerInstallRetireIntents,
} from "./ownership.ts";
import {
	format_server_install_retention_error,
	is_missing_platform_error,
	ServerInstallRetentionError,
} from "./errors.ts";
import { CleanupServerInstallStaging, server_install_staging_prefix } from "./staging.ts";
import { Effect, FileSystem, Option, Path, Result } from "effect";
import { ServerInstallRetentionPolicy } from "./policy.ts";
import { ExtensionOutput } from "../extension-services.ts";

const server_install_observation_prefix = ".ser-observed-";
const server_install_retired_prefix = ".ser-retired-install-";

export type ServerInstallRetentionDependencies =
	| ExtensionOutput
	| FileSystem.FileSystem
	| Path.Path
	| ServerInstallRetentionPolicy;

export const MakeServerInstallRetention = (cache_root: string) =>
	Effect.gen(function* () {
		const resolver_scope = yield* Effect.scope;
		const lease_manager = yield* MakeServerInstallLeaseManager(resolver_scope);

		return {
			cleanup: (protected_install_root: Option.Option<string>) =>
				CleanupObsoleteServerInstalls(cache_root, protected_install_root),
			ensure_lease: (install_root: string, server_path: string) =>
				lease_manager.ensure(install_root, server_path),
		};
	});

const CleanupObsoleteServerInstalls = (
	cache_root: string,
	protected_install_root: Option.Option<string>,
) =>
	Effect.gen(function* () {
		const output = yield* ExtensionOutput;

		yield* CleanupServerInstallCache(cache_root, protected_install_root).pipe(
			Effect.catch((error) =>
				output.append_line(
					`Could not clean obsolete language-server installs: ${format_server_install_retention_error(error)}`,
				),
			),
		);
	});

const CleanupServerInstallCache = (
	cache_root: string,
	protected_install_root: Option.Option<string>,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const output = yield* ExtensionOutput;
		const path_service = yield* Path.Path;
		const policy = yield* ServerInstallRetentionPolicy;
		const cache_exists = yield* file_system.exists(cache_root);

		if (!cache_exists) {
			return;
		}

		const now = yield* policy.current_time_millis;
		const entries = (yield* file_system.readDirectory(cache_root)).toSorted();

		for (const entry of entries) {
			const entry_path = path_service.join(cache_root, entry);

			if (entry.startsWith(server_install_retired_prefix)) {
				yield* RemoveRetiredServerInstall(entry_path).pipe(
					Effect.catch((error) =>
						is_missing_platform_error(error)
							? Effect.void
							: output.append_line(
									`Could not finish deleting retired language-server install ${entry}: ${format_server_install_retention_error(error)}`,
								),
					),
				);

				continue;
			}

			if (entry.startsWith(server_install_staging_prefix)) {
				yield* CleanupServerInstallStaging(entry_path, entry, now).pipe(
					Effect.catch((error) =>
						is_missing_platform_error(error)
							? Effect.void
							: output.append_line(
									`Could not clean abandoned language-server staging install ${entry}: ${format_server_install_retention_error(error)}`,
								),
					),
				);

				continue;
			}

			if (entry.startsWith(".")) {
				continue;
			}

			if (
				Option.isSome(protected_install_root) &&
				entry_path === protected_install_root.value
			) {
				continue;
			}

			const entry_info = yield* Effect.option(file_system.stat(entry_path));

			if (Option.isNone(entry_info) || entry_info.value.type !== "Directory") {
				continue;
			}

			yield* CleanupServerInstall(entry_path, now).pipe(
				Effect.catch((error) =>
					is_missing_platform_error(error)
						? Effect.void
						: output.append_line(
								`Could not clean obsolete language-server install ${entry_path}: ${format_server_install_retention_error(error)}`,
							),
				),
			);
		}
	});

const RemoveRetiredServerInstall = (retired_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		yield* file_system.remove(retired_path, { force: true, recursive: true });
	});

const CleanupServerInstall = (install_root: string, now: number) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const policy = yield* ServerInstallRetentionPolicy;
		const install_info = yield* Effect.option(file_system.stat(install_root));

		if (Option.isNone(install_info) || install_info.value.type !== "Directory") {
			return;
		}

		const observed_at = yield* ReadOrCreateServerInstallObservation(install_root, now);

		if (Option.isNone(observed_at) || now - observed_at.value < policy.rollout_grace_millis) {
			return;
		}

		yield* ReapDeadServerInstallRetireIntents(install_root);

		const retired_path = yield* Effect.acquireUseRelease(
			PublishServerInstallRetireIntent(install_root),
			(intent_path) => Effect.uninterruptible(RetireServerInstall(install_root, intent_path)),
			(intent_path) => file_system.remove(intent_path, { force: true }).pipe(Effect.ignore),
		);

		if (Option.isNone(retired_path)) {
			return;
		}

		yield* file_system.remove(retired_path.value, { force: true, recursive: true });
	});

const RetireServerInstall = (install_root: string, intent_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const policy = yield* ServerInstallRetentionPolicy;
		const install_info = yield* Effect.option(file_system.stat(install_root));

		if (Option.isNone(install_info) || install_info.value.type !== "Directory") {
			return Option.none<string>();
		}

		yield* policy.on_transition({
			_tag: "RetireIntentPublished",
			install_root,
		});

		const has_live_lease = yield* HasLiveServerInstallLease(install_root);

		if (has_live_lease) {
			return Option.none<string>();
		}

		const cache_root = path_service.dirname(install_root);
		const intent_name = path_service.basename(intent_path);
		const retired_path = path_service.join(
			cache_root,
			`${server_install_retired_prefix}${encodeURIComponent(intent_name)}`,
		);

		yield* policy.on_transition({
			_tag: "RetireReady",
			install_root,
		});

		const retirement = yield* Effect.result(file_system.rename(install_root, retired_path));

		if (Result.isSuccess(retirement)) {
			return Option.some(retired_path);
		}

		const install_still_exists = yield* file_system.exists(install_root);

		if (!install_still_exists) {
			return Option.none<string>();
		}

		return yield* Effect.fail(retirement.failure);
	});

const ReadOrCreateServerInstallObservation = (install_root: string, now: number) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const entries = yield* file_system.readDirectory(install_root);
		const observation_entries = entries.filter((entry) =>
			entry.startsWith(server_install_observation_prefix),
		);

		if (observation_entries.length === 0) {
			yield* file_system.makeTempDirectory({
				directory: install_root,
				prefix: `${server_install_observation_prefix}${now}-`,
			});

			return Option.none<number>();
		}

		const observed_at_millis = yield* Effect.forEach(observation_entries, (entry) =>
			Effect.gen(function* () {
				const match = /^\.ser-observed-(\d+)-/.exec(entry);
				const observed_at = match ? Number(match[1]) : Number.NaN;

				if (!Number.isFinite(observed_at)) {
					return yield* new ServerInstallRetentionError({
						message: `Language-server install has an invalid retention observation: ${entry}.`,
					});
				}

				return observed_at;
			}),
		);

		return Option.some(Math.min(...observed_at_millis));
	});
