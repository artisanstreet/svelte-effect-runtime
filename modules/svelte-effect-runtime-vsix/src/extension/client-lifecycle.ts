import { Effect, Option, Ref, Scope, Semaphore } from "effect";

/**
 * One direct language-client resource owned by the serialized lifecycle.
 *
 * @example
 * ```ts
 * const handle: SerializedClientHandle = {
 * 	start: Effect.void,
 * 	stop: Effect.void,
 * 	dispose: Effect.void,
 * };
 * ```
 *
 * @since 4.0.1
 */
export interface SerializedClientHandle {
	/** Starts the underlying client resource. */
	readonly start: Effect.Effect<void, unknown>;
	/** Stops the underlying client resource gracefully. */
	readonly stop: Effect.Effect<void, unknown>;
	/** Releases the client even when graceful shutdown fails. */
	readonly dispose: Effect.Effect<void>;
}

/**
 * Serialized start and stop operations for one lazily-created client.
 *
 * @example
 * ```ts
 * const control = yield* MakeSerializedClientControl(CreateClient);
 * yield* control.start(server_path);
 * ```
 *
 * @since 4.0.1
 */
export interface SerializedClientControl {
	/** Starts or replaces the client for the requested server path. */
	readonly start: (server_path: string) => Effect.Effect<void, unknown>;
	/** Stops and disposes the active client, if present. */
	readonly stop: Effect.Effect<void, unknown>;
}

interface ActiveSerializedClient {
	readonly handle: SerializedClientHandle;
	readonly server_path: string;
}

/**
 * Builds an activation-scoped, semaphore-serialized client lifecycle.
 *
 * @example
 * ```ts
 * const control = yield* MakeSerializedClientControl(CreateClient);
 * yield* control.start(server_path);
 * ```
 *
 * @since 4.0.1
 * @param CreateClient - Effectful factory for a client bound to one server path.
 * @returns An Effect yielding serialized start and stop operations. The active
 *   client is stopped automatically when the surrounding scope closes.
 */
export function MakeSerializedClientControl(
	CreateClient: (server_path: string) => Effect.Effect<SerializedClientHandle, unknown>,
): Effect.Effect<SerializedClientControl, never, Scope.Scope> {
	return Effect.gen(function* () {
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
}

function StartClient(
	client_ref: Ref.Ref<Option.Option<ActiveSerializedClient>>,
	CreateClient: (server_path: string) => Effect.Effect<SerializedClientHandle, unknown>,
	server_path: string,
): Effect.Effect<void, unknown> {
	return Effect.gen(function* () {
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
}

function StopActiveClient(
	client_ref: Ref.Ref<Option.Option<ActiveSerializedClient>>,
): Effect.Effect<void, unknown> {
	return Effect.gen(function* () {
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
}
