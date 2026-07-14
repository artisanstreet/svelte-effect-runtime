import { Clock, Context, Effect, Layer, Option, Result, Schema } from "effect";
import { randomUUID } from "node:crypto";

import process from "node:process";

const server_install_rollout_grace_millis = 7 * 24 * 60 * 60 * 1_000;

const ProcessSignalErrorSchema = Schema.Struct({
	code: Schema.String,
});

const IsProcessAlive = (pid: number) =>
	Effect.gen(function* () {
		const signal = yield* Effect.result(
			Effect.try({
				try: () => process.kill(pid, 0),
				catch: (cause) => cause,
			}),
		);

		if (Result.isSuccess(signal)) {
			return true;
		}

		const error = Schema.decodeUnknownOption(ProcessSignalErrorSchema)(signal.failure);

		if (Option.isSome(error) && error.value.code === "ESRCH") {
			return false;
		}

		if (Option.isSome(error) && error.value.code === "EPERM") {
			return true;
		}

		return yield* Effect.fail(signal.failure);
	});

interface ServerInstallLeasePrecheckComplete {
	readonly _tag: "LeasePrecheckComplete";
	readonly install_root: string;
}

interface ServerInstallLeasePublished {
	readonly _tag: "LeasePublished";
	readonly install_root: string;
}

interface ServerInstallRetireIntentPublished {
	readonly _tag: "RetireIntentPublished";
	readonly install_root: string;
}

interface ServerInstallRetireReady {
	readonly _tag: "RetireReady";
	readonly install_root: string;
}

export type ServerInstallRetentionTransition =
	| ServerInstallLeasePrecheckComplete
	| ServerInstallLeasePublished
	| ServerInstallRetireIntentPublished
	| ServerInstallRetireReady;

export class ServerInstallRetentionPolicy extends Context.Service<
	ServerInstallRetentionPolicy,
	{
		readonly current_pid: number;
		readonly current_time_millis: Effect.Effect<number>;
		readonly is_process_alive: (pid: number) => Effect.Effect<boolean, unknown>;
		readonly next_generation: Effect.Effect<string>;
		readonly on_transition: (
			transition: ServerInstallRetentionTransition,
		) => Effect.Effect<void>;
		readonly rollout_grace_millis: number;
	}
>()("svelte-effect-runtime-vsix/ServerInstallRetentionPolicy") {}

export const ServerInstallRetentionPolicyLive = Layer.succeed(ServerInstallRetentionPolicy, {
	current_pid: process.pid,
	current_time_millis: Clock.currentTimeMillis,
	is_process_alive: IsProcessAlive,
	next_generation: Effect.sync(randomUUID),
	on_transition: () => Effect.void,
	rollout_grace_millis: server_install_rollout_grace_millis,
});
