import { Effect, FileSystem, Option, Path, Ref, Result, Schema, Scope } from "effect";
import { is_missing_platform_error, ServerInstallRetentionError } from "./errors.ts";
import { ServerInstallRetentionPolicy } from "./policy.ts";

const server_install_lease_prefix = ".ser-lease-";
const server_install_retire_intent_prefix = ".ser-retire-";

const ServerInstallOwnerSchema = Schema.Struct({
	pid: Schema.Int,
});

interface ServerInstallLeaseOwnership {
	readonly install_root: string;
	readonly lease_path: string;
}

export const MakeServerInstallLeaseManager = (resolver_scope: Scope.Scope) =>
	Effect.gen(function* () {
		const owned_leases = yield* Ref.make<ReadonlyArray<ServerInstallLeaseOwnership>>([]);

		return {
			ensure: (install_root: string, server_path: string) =>
				EnsureServerInstallLease(install_root, server_path, owned_leases, resolver_scope),
		};
	});

export const CanUseServerInstall = (install_root: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const policy = yield* ServerInstallRetentionPolicy;
		const entries = yield* Effect.result(file_system.readDirectory(install_root));

		if (Result.isFailure(entries)) {
			if (is_missing_platform_error(entries.failure)) {
				return false;
			}

			return yield* Effect.fail(entries.failure);
		}

		const intent_entries = entries.success.filter((entry) =>
			entry.startsWith(server_install_retire_intent_prefix),
		);

		for (const entry of intent_entries) {
			const intent_path = path_service.join(install_root, entry);
			const owner = yield* ReadExistingServerInstallOwner(intent_path);

			if (Option.isNone(owner)) {
				return false;
			}

			const owner_is_alive = yield* policy.is_process_alive(owner.value.pid);

			if (owner_is_alive) {
				return false;
			}

			yield* file_system.remove(intent_path, { force: true });
		}

		return true;
	});

export const ReapDeadServerInstallRetireIntents = (install_root: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const policy = yield* ServerInstallRetentionPolicy;
		const entries = yield* file_system.readDirectory(install_root);
		const intent_entries = entries.filter((entry) =>
			entry.startsWith(server_install_retire_intent_prefix),
		);

		for (const entry of intent_entries) {
			const intent_path = path_service.join(install_root, entry);
			const owner = yield* ReadExistingServerInstallOwner(intent_path);

			if (Option.isNone(owner)) {
				continue;
			}

			const owner_is_alive = yield* policy.is_process_alive(owner.value.pid);

			if (!owner_is_alive) {
				yield* file_system.remove(intent_path, { force: true });
			}
		}
	});

export const PublishServerInstallRetireIntent = (install_root: string) =>
	Effect.gen(function* () {
		const policy = yield* ServerInstallRetentionPolicy;

		return yield* PublishServerInstallOwnerFile(
			install_root,
			`.tmp-ser-retire-${policy.current_pid}-`,
			server_install_retire_intent_prefix,
		);
	});

export const HasLiveServerInstallLease = (install_root: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const policy = yield* ServerInstallRetentionPolicy;
		const entries = yield* file_system.readDirectory(install_root);
		const lease_entries = entries.filter((entry) =>
			entry.startsWith(server_install_lease_prefix),
		);
		const lease_liveness = yield* Effect.forEach(lease_entries, (entry) =>
			Effect.gen(function* () {
				const lease_path = path_service.join(install_root, entry);
				const lease = yield* ReadExistingServerInstallOwner(lease_path);

				if (Option.isNone(lease)) {
					return false;
				}

				const process_is_alive = yield* policy.is_process_alive(lease.value.pid);

				if (process_is_alive) {
					return true;
				}

				yield* file_system.remove(lease_path, { force: true });

				return false;
			}),
		);

		return lease_liveness.some(Boolean);
	});

const EnsureServerInstallLease = (
	install_root: string,
	server_path: string,
	owned_leases: Ref.Ref<ReadonlyArray<ServerInstallLeaseOwnership>>,
	resolver_scope: Scope.Scope,
) =>
	Effect.gen(function* () {
		const policy = yield* ServerInstallRetentionPolicy;
		const current_leases = yield* Ref.get(owned_leases);
		const current_lease = current_leases.find((lease) => lease.install_root === install_root);

		if (current_lease) {
			const lease_is_current = yield* ServerInstallLeaseIsCurrent(current_lease, server_path);

			if (lease_is_current) {
				return true;
			}

			yield* Ref.update(owned_leases, (leases) =>
				leases.filter((lease) => lease.install_root !== install_root),
			);
		}

		const can_publish = yield* ServerInstallCanAcceptLease(install_root, server_path);

		if (!can_publish) {
			return false;
		}

		yield* policy.on_transition({
			_tag: "LeasePrecheckComplete",
			install_root,
		});

		return yield* Effect.uninterruptible(
			PublishAndOwnServerInstallLease(
				install_root,
				server_path,
				owned_leases,
				resolver_scope,
			).pipe(
				Effect.catch((error) =>
					is_missing_platform_error(error) ? Effect.succeed(false) : Effect.fail(error),
				),
			),
		);
	});

const PublishAndOwnServerInstallLease = (
	install_root: string,
	server_path: string,
	owned_leases: Ref.Ref<ReadonlyArray<ServerInstallLeaseOwnership>>,
	resolver_scope: Scope.Scope,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const policy = yield* ServerInstallRetentionPolicy;
		const lease_path = yield* PublishServerInstallOwnerFile(
			install_root,
			`.tmp-ser-lease-${policy.current_pid}-`,
			server_install_lease_prefix,
		);
		const RollbackLease = file_system.remove(lease_path, { force: true }).pipe(Effect.ignore);
		const OwnLease = Effect.gen(function* () {
			yield* policy.on_transition({
				_tag: "LeasePublished",
				install_root,
			});

			const ownership = { install_root, lease_path };
			const lease_is_current = yield* ServerInstallLeaseIsCurrent(ownership, server_path);

			if (!lease_is_current) {
				yield* RollbackLease;

				return false;
			}

			yield* Scope.addFinalizer(resolver_scope, RollbackLease);
			yield* Ref.update(owned_leases, (leases) => [
				...leases.filter((lease) => lease.install_root !== install_root),
				ownership,
			]);

			return true;
		});

		return yield* OwnLease.pipe(Effect.onError(() => RollbackLease));
	});

const ServerInstallLeaseIsCurrent = (ownership: ServerInstallLeaseOwnership, server_path: string) =>
	Effect.gen(function* () {
		const can_use_install = yield* CanUseServerInstall(ownership.install_root);
		const lease_exists = yield* IsRegularFile(ownership.lease_path);
		const server_exists = yield* IsRegularFile(server_path);

		return lease_exists && server_exists && can_use_install;
	});

const ServerInstallCanAcceptLease = (install_root: string, server_path: string) =>
	Effect.gen(function* () {
		const server_exists = yield* IsRegularFile(server_path);

		if (!server_exists) {
			return false;
		}

		return yield* CanUseServerInstall(install_root);
	});

const PublishServerInstallOwnerFile = (
	install_root: string,
	temporary_prefix: string,
	published_prefix: string,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const policy = yield* ServerInstallRetentionPolicy;
		const temporary_path = yield* file_system.makeTempFile({
			directory: install_root,
			prefix: temporary_prefix,
		});
		const temporary_root = path_service.dirname(temporary_path);
		const nonce = path_service.basename(temporary_path);
		const published_path = path_service.join(
			install_root,
			`${published_prefix}${policy.current_pid}-${nonce}.json`,
		);

		yield* file_system
			.writeFileString(temporary_path, `${JSON.stringify({ pid: policy.current_pid })}\n`)
			.pipe(
				Effect.andThen(file_system.rename(temporary_path, published_path)),
				Effect.ensuring(
					file_system
						.remove(temporary_root, { force: true, recursive: true })
						.pipe(Effect.ignore),
				),
			);

		return published_path;
	});

const ReadExistingServerInstallOwner = (owner_path: string) =>
	Effect.gen(function* () {
		const owner = yield* Effect.result(ReadServerInstallOwner(owner_path));

		if (Result.isSuccess(owner)) {
			return Option.some(owner.success);
		}

		if (is_missing_platform_error(owner.failure)) {
			return Option.none<{ readonly pid: number }>();
		}

		return yield* Effect.fail(owner.failure);
	});

const ReadServerInstallOwner = (owner_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const source = yield* file_system.readFileString(owner_path);
		const owner = yield* Schema.decodeUnknownEffect(
			Schema.fromJsonString(ServerInstallOwnerSchema),
		)(source);

		if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
			return owner;
		}

		return yield* new ServerInstallRetentionError({
			message: `Language-server install owner has an invalid process id: ${owner_path}.`,
		});
	});

const IsRegularFile = (path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const info = yield* Effect.option(file_system.stat(path));

		return Option.isSome(info) && info.value.type === "File";
	});
