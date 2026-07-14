import {
	ServerInstallRetentionPolicy,
	type ServerInstallRetentionTransition,
} from "../../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts";
import { language_server_package_version } from "../../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-package.ts";
import { language_server_package_name } from "../../../../modules/svelte-effect-runtime-vsix/src/extension/constants.ts";
import { Deferred, Effect, FileSystem, Layer } from "effect";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

interface PolicyOptions {
	readonly current_pid?: number;
	readonly current_time_millis?: Effect.Effect<number>;
	readonly is_process_alive?: (pid: number) => Effect.Effect<boolean, unknown>;
	readonly next_generation?: Effect.Effect<string>;
	readonly on_transition?: (transition: ServerInstallRetentionTransition) => Effect.Effect<void>;
	readonly rollout_grace_millis?: number;
}

export function make_policy_layer(options: PolicyOptions = {}) {
	const current_pid = options.current_pid ?? 100;

	return Layer.succeed(ServerInstallRetentionPolicy, {
		current_pid,
		current_time_millis: options.current_time_millis ?? Effect.succeed(2_000),
		is_process_alive:
			options.is_process_alive ?? ((pid: number) => Effect.succeed(pid === current_pid)),
		next_generation: options.next_generation ?? Effect.sync(randomUUID),
		on_transition: options.on_transition ?? (() => Effect.void),
		rollout_grace_millis: options.rollout_grace_millis ?? 1_000,
	});
}

export const MakeDeferredGate = Effect.gen(function* () {
	const deferred = yield* Deferred.make<void>();

	return {
		await_open: Deferred.await(deferred),
		open: Deferred.succeed(deferred, undefined).pipe(Effect.asVoid),
	};
});

export const WritePublishedServerInstall = (
	install_root: string,
	version = language_server_package_version,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const package_root = join(install_root, "node_modules", language_server_package_name);
		const server_path = join(package_root, ".dist", "server.cjs");

		yield* file_system.makeDirectory(dirname(server_path), { recursive: true });
		yield* file_system.makeDirectory(join(package_root, "runtime"), { recursive: true });
		yield* file_system.writeFileString(
			join(package_root, "package.json"),
			`${JSON.stringify({ version })}\n`,
		);
		yield* file_system.writeFileString(server_path, "module.exports = {};\n");
		yield* file_system.writeFileString(join(package_root, "runtime", "package.json"), "{}\n");

		return server_path;
	});

export const WriteObservation = (install_root: string, observed_at_millis: number) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		yield* file_system.writeFileString(
			join(install_root, `.ser-observed-${observed_at_millis}-test`),
			"",
		);
	});

export const WriteStagingOwner = (
	staging_root: string,
	pid: number,
	generation: string,
	created_at_millis: number,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		yield* file_system.makeDirectory(staging_root, { recursive: true });
		yield* file_system.writeFileString(
			join(staging_root, ".ser-install-generation.json"),
			`${JSON.stringify({ created_at_millis, generation, pid })}\n`,
		);
	});
