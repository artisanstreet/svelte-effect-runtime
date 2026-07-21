import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { ServerInstallRetentionPolicy } from "./policy.ts";
import { ServerInstallRetentionError } from "./errors.ts";

export const server_install_staging_prefix = ".ser-stage-";
const server_install_staging_abandoned_file = ".ser-staging-abandoned";
const server_install_generation_file = ".ser-install-generation.json";

const ServerInstallGenerationSchema = Schema.Struct({
	created_at_millis: Schema.Number,
	generation: Schema.String,
	pid: Schema.Int,
});

export interface ServerInstallStaging {
	readonly install_identity: string;
	readonly root: string;
}

export const MakeServerInstallStaging = (cache_root: string, target_version: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const AcquireStaging = Effect.gen(function* () {
			const path_service = yield* Path.Path;
			const policy = yield* ServerInstallRetentionPolicy;
			const created_at_millis = yield* policy.current_time_millis;
			const generation = yield* policy.next_generation;
			const staging_prefix = `${server_install_staging_prefix}${policy.current_pid}-${generation}-${encodeURIComponent(target_version)}-`;
			const root = yield* file_system.makeTempDirectory({
				directory: cache_root,
				prefix: staging_prefix,
			});
			const owner_path = path_service.join(root, server_install_generation_file);
			const owner = {
				created_at_millis,
				generation,
				pid: policy.current_pid,
			};

			yield* file_system
				.writeFileString(owner_path, `${JSON.stringify(owner)}\n`)
				.pipe(
					Effect.onError(() =>
						file_system
							.remove(root, { force: true, recursive: true })
							.pipe(Effect.ignore),
					),
				);

			return {
				install_identity: encodeURIComponent(path_service.basename(root)),
				root,
			} satisfies ServerInstallStaging;
		});

		return yield* Effect.acquireRelease(AcquireStaging, (staging) =>
			AbandonServerInstallStaging(staging.root).pipe(Effect.ignore),
		);
	});

const AbandonServerInstallStaging = (staging_root: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const staging_exists = yield* file_system.exists(staging_root);

		if (!staging_exists) {
			return;
		}

		yield* file_system
			.writeFileString(path_service.join(staging_root, server_install_staging_abandoned_file), "")
			.pipe(
				Effect.ensuring(
					file_system
						.remove(staging_root, { force: true, recursive: true })
						.pipe(Effect.ignore),
				),
			);
	});

export const CleanupServerInstallStaging = (staging_root: string, entry: string, now: number) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const policy = yield* ServerInstallRetentionPolicy;
		const abandoned_path = path_service.join(
			staging_root,
			server_install_staging_abandoned_file,
		);
		const is_abandoned = yield* file_system.exists(abandoned_path);

		if (is_abandoned) {
			yield* file_system.remove(staging_root, { force: true, recursive: true });

			return;
		}

		const owner_path = path_service.join(staging_root, server_install_generation_file);
		const owner = yield* ReadServerInstallStagingOwner(staging_root, entry, owner_path);
		const owner_is_alive = yield* policy.is_process_alive(owner.pid);

		if (owner_is_alive || now - owner.created_at_millis < policy.rollout_grace_millis) {
			return;
		}

		yield* file_system.remove(staging_root, { force: true, recursive: true });
	});

const ReadServerInstallStagingOwner = (staging_root: string, entry: string, owner_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const pid_match = /^\.ser-stage-(\d+)-/.exec(entry);
		const entry_pid = pid_match ? Number(pid_match[1]) : Number.NaN;
		const owner = yield* Effect.result(ReadServerInstallGeneration(owner_path));

		if (Result.isSuccess(owner)) {
			const expected_prefix = `${server_install_staging_prefix}${owner.success.pid}-${owner.success.generation}-`;

			if (
				Number.isSafeInteger(entry_pid) &&
				entry_pid === owner.success.pid &&
				Number.isSafeInteger(owner.success.pid) &&
				owner.success.pid > 0 &&
				Number.isFinite(owner.success.created_at_millis) &&
				owner.success.generation.length > 0 &&
				entry.startsWith(expected_prefix)
			) {
				return owner.success;
			}

			return yield* new ServerInstallRetentionError({
				message: `Language-server staging owner metadata is invalid: ${owner_path}.`,
			});
		}

		const staging_info = yield* file_system.stat(staging_root);
		const modified_at = Option.getOrUndefined(staging_info.mtime)?.getTime();

		if (!Number.isSafeInteger(entry_pid) || entry_pid <= 0 || modified_at === undefined) {
			return yield* new ServerInstallRetentionError({
				cause: owner.failure,
				message: `Language-server staging install has no trustworthy owner or age: ${staging_root}.`,
			});
		}

		return {
			created_at_millis: modified_at,
			generation: "unknown",
			pid: entry_pid,
		};
	});

const ReadServerInstallGeneration = (owner_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const source = yield* file_system.readFileString(owner_path);

		return yield* Schema.decodeUnknownEffect(
			Schema.fromJsonString(ServerInstallGenerationSchema),
		)(source);
	});
