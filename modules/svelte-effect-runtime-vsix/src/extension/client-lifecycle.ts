import { Effect, Option, Ref, Semaphore } from "effect";

export interface SerializedClientHandle {
	readonly start: Effect.Effect<void, unknown>;
	readonly stop: Effect.Effect<void, unknown>;
	readonly dispose: Effect.Effect<void>;
}

export interface SerializedClientControl {
	readonly start: (server_path: string) => Effect.Effect<void, unknown>;
	readonly stop: Effect.Effect<void, unknown>;
}

interface ActiveSerializedClient {
	readonly handle: SerializedClientHandle;
	readonly server_path: string;
}

/** Serializes client replacement so only one language client remains active. */
export const MakeSerializedClientControl = (
	CreateClient: (server_path: string) => Effect.Effect<SerializedClientHandle, unknown>,
) =>
	Effect.gen(function* () {
		const client_ref = yield* Ref.make(Option.none<ActiveSerializedClient>());
		const semaphore = yield* Semaphore.make(1);
		const Stop = semaphore.withPermits(1)(StopActiveClient(client_ref));
		const Start = (server_path: string) =>
			semaphore.withPermits(1)(StartClient(client_ref, CreateClient, server_path));

		yield* Effect.addFinalizer(() => Effect.ignore(Stop));

		return {
			start: Start,
			stop: Stop,
		};
	});

const StartClient = (
	client_ref: Ref.Ref<Option.Option<ActiveSerializedClient>>,
	CreateClient: (server_path: string) => Effect.Effect<SerializedClientHandle, unknown>,
	server_path: string,
) =>
	Effect.gen(function* () {
		const active_client = yield* Ref.get(client_ref);

		if (Option.isSome(active_client) && active_client.value.server_path === server_path) {
			return;
		}

		if (Option.isSome(active_client)) {
			yield* StopActiveClient(client_ref).pipe(Effect.ignore);
		}

		const next_client = yield* CreateClient(server_path);
		const StartAndStore = Effect.gen(function* () {
			yield* next_client.start;
			yield* Ref.set(client_ref, Option.some({ handle: next_client, server_path }));
		}).pipe(Effect.onError(() => next_client.dispose));

		yield* StartAndStore;
	});

const StopActiveClient = (client_ref: Ref.Ref<Option.Option<ActiveSerializedClient>>) =>
	Effect.gen(function* () {
		const active_client = yield* Ref.get(client_ref);

		if (Option.isNone(active_client)) {
			return;
		}

		const ClearClient = Ref.set(client_ref, Option.none());
		const StopClient = active_client.value.handle.stop.pipe(
			Effect.ensuring(active_client.value.handle.dispose),
			Effect.ensuring(ClearClient),
		);

		yield* StopClient;
	});
