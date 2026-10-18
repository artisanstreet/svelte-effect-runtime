import type {
	EffectRemoteLiveQuery,
	EffectRemoteQuery,
	RemoteQueryValidatedArgument,
} from "./types.ts";
import { to_effect_live_query_resource, to_effect_query_resource } from "./factories.ts";
import { get_native_remote_query_update } from "$/remote/query-update.ts";
import { requested as native_requested } from "$app/server";
import { Effect } from "effect";

type AnyEffectRemoteQueryFunction<A = any, E = any, Validated = unknown> = ((
	...args: never[]
) => EffectRemoteQuery<A, E>) &
	RemoteQueryValidatedArgument<Validated>;

type AnyEffectRemoteLiveQueryFunction<A = any, E = any, Validated = unknown> = ((
	...args: never[]
) => EffectRemoteLiveQuery<A, E>) &
	RemoteQueryValidatedArgument<Validated>;

type NativeRequestedEntry = {
	readonly arg: unknown;
	readonly query: unknown;
	readonly ignore?: () => void;
};

type NativeRequestedResult = AsyncIterable<NativeRequestedEntry> & {
	readonly refreshAll?: () => Promise<void>;
	readonly reconnectAll?: () => Promise<void>;
	readonly ignoreAll?: () => Promise<void>;
};

type NativeQueryInternals = {
	readonly __?: { readonly type?: string };
};

/**
 * A query instance the client asked a command or form to refresh.
 *
 * @since 5.0.0
 */
export interface RequestedQuery<Arg, A, E = never> {
	/** The query argument after the query's schema validated it. */
	readonly arg: Arg;
	/** The query bound to the client's cache key; `refresh()` and `set()` reach that client entry. */
	readonly query: EffectRemoteQuery<A, E>;
	/** Explicitly declines this refresh so SvelteKit 3 does not fail the client query. */
	readonly ignore: Effect.Effect<void>;
}

/**
 * A live query instance the client asked a command or form to reconnect.
 *
 * @since 5.0.0
 */
export interface RequestedLiveQuery<Arg, A, E = never> {
	/** The live query argument after the query's schema validated it. */
	readonly arg: Arg;
	/** The live query bound to the client's cache key; reconnect it with `Live.reconnect`. */
	readonly query: EffectRemoteLiveQuery<A, E>;
	/** Explicitly declines this reconnect so SvelteKit 3 does not fail the client query. */
	readonly ignore: Effect.Effect<void>;
}

/**
 * Server export shape for answering client-requested refreshes.
 *
 * @since 5.0.0
 */
export interface RequestedFactory {
	/**
	 * Lists the instances of a query that the client asked this command or form
	 * to refresh through `.updates(...)`.
	 *
	 * @example
	 * ```ts
	 * export const CreatePost = Command(PostInput, (input) =>
	 *   Effect.gen(function* () {
	 *     yield* Posts.create(input);
	 *
	 *     for (const { arg, query, ignore } of yield* Requested(GetPosts, 10)) {
	 *       yield* arg.author === input.author ? query.refresh() : ignore;
	 *     }
	 *   }),
	 * );
	 * ```
	 *
	 * @since 5.0.0
	 * @param query - SER query or batch query function whose client instances
	 *   should be inspected.
	 * @param limit - Maximum number of client-requested instances to accept.
	 *   The client controls the request, so keep this bounded; instances past
	 *   the limit fail on the client.
	 * @returns An Effect producing one entry per accepted instance, with the
	 *   validated argument, the bound query, and an `ignore` Effect.
	 */
	<A, E, Validated>(
		query: AnyEffectRemoteQueryFunction<A, E, Validated>,
		limit: number,
	): Effect.Effect<ReadonlyArray<RequestedQuery<Validated, A, E>>>;
	/**
	 * Lists the instances of a live query that the client asked this command
	 * or form to reconnect through `.updates(...)`.
	 *
	 * @since 5.0.0
	 * @param query - SER live query function whose client instances should be
	 *   inspected.
	 * @param limit - Maximum number of client-requested instances to accept.
	 * @returns An Effect producing one entry per accepted instance, with the
	 *   validated argument, the bound live query, and an `ignore` Effect.
	 */
	<A, E, Validated>(
		query: AnyEffectRemoteLiveQueryFunction<A, E, Validated>,
		limit: number,
	): Effect.Effect<ReadonlyArray<RequestedLiveQuery<Validated, A, E>>>;

	/**
	 * Refreshes every client-requested instance of a query, up to `limit`.
	 *
	 * @example
	 * ```ts
	 * yield* Requested.refreshAll(GetPosts, 1);
	 * ```
	 *
	 * @since 5.0.0
	 * @param query - SER query or batch query function to refresh.
	 * @param limit - Maximum number of client-requested instances to refresh.
	 * @returns An Effect that completes once every accepted instance has been
	 *   scheduled for refresh in this response.
	 */
	readonly refreshAll: (
		query: AnyEffectRemoteQueryFunction,
		limit: number,
	) => Effect.Effect<void>;

	/**
	 * Reconnects every client-requested instance of a live query, up to `limit`.
	 *
	 * @example
	 * ```ts
	 * yield* Requested.reconnectAll(GetNotifications, 1);
	 * ```
	 *
	 * @since 5.0.0
	 * @param query - SER live query function to reconnect.
	 * @param limit - Maximum number of client-requested instances to reconnect.
	 * @returns An Effect that completes once every accepted instance has been
	 *   scheduled for reconnect in this response.
	 */
	readonly reconnectAll: (
		query: AnyEffectRemoteLiveQueryFunction,
		limit: number,
	) => Effect.Effect<void>;

	/**
	 * Explicitly declines every client-requested instance of a query, up to
	 * `limit`. On SvelteKit 2 this is a no-op because unanswered requests are
	 * silently skipped there.
	 *
	 * @example
	 * ```ts
	 * yield* Requested.ignoreAll(GetPosts, 10);
	 * ```
	 *
	 * @since 5.0.0
	 * @param query - SER query, batch query, or live query function to decline.
	 * @param limit - Maximum number of client-requested instances to decline.
	 * @returns An Effect that completes once every accepted instance is ignored.
	 */
	readonly ignoreAll: (
		query: AnyEffectRemoteQueryFunction | AnyEffectRemoteLiveQueryFunction,
		limit: number,
	) => Effect.Effect<void>;
}

const RequestNative = (query: unknown, limit: number) =>
	Effect.sync(
		() =>
			native_requested(
				to_native_query(query) as never,
				limit,
			) as unknown as NativeRequestedResult,
	);

const ListRequested = (query: unknown, limit: number) =>
	Effect.gen(function* () {
		const native = to_native_query(query);
		const is_live = get_query_type(native) === "query_live";
		const result = yield* RequestNative(query, limit);

		const entries = yield* Effect.promise(() => collect_entries(result));

		return entries.map((entry) => ({
			arg: entry.arg,
			query: is_live
				? to_effect_live_query_resource(entry.query)
				: to_effect_query_resource(entry.query),
			ignore: Effect.sync(() => entry.ignore?.()),
		}));
	});

const RefreshAll = (query: AnyEffectRemoteQueryFunction, limit: number) =>
	Effect.gen(function* () {
		const result = yield* RequestNative(query, limit);

		yield* Effect.promise(() => result.refreshAll?.() ?? Promise.resolve());
	});

const ReconnectAll = (query: AnyEffectRemoteLiveQueryFunction, limit: number) =>
	Effect.gen(function* () {
		const result = yield* RequestNative(query, limit);

		yield* Effect.promise(() => result.reconnectAll?.() ?? Promise.resolve());
	});

/**
 * SvelteKit 2 has no `ignoreAll`; draining the iterator consumes the
 * requests, which is all ignoring means there.
 */
const IgnoreAll = (
	query: AnyEffectRemoteQueryFunction | AnyEffectRemoteLiveQueryFunction,
	limit: number,
) =>
	Effect.gen(function* () {
		const result = yield* RequestNative(query, limit);
		const ignore_all = result.ignoreAll;

		if (typeof ignore_all === "function") {
			return yield* Effect.promise(() => ignore_all.call(result));
		}

		yield* Effect.promise(() => collect_entries(result));
	});

async function collect_entries(
	result: AsyncIterable<NativeRequestedEntry>,
): Promise<NativeRequestedEntry[]> {
	const entries: NativeRequestedEntry[] = [];

	for await (const entry of result) {
		entries.push(entry);
	}

	return entries;
}

function to_native_query(query: unknown): unknown {
	return get_native_remote_query_update(query) ?? query;
}

function get_query_type(native: unknown): string | undefined {
	if (typeof native !== "function") {
		return undefined;
	}

	return (native as NativeQueryInternals).__?.type;
}

/**
 * Answers client-requested refreshes inside a remote `Command` or `Form`.
 * Pair it with `.updates(...)` on the client: every instance the client lists
 * must be refreshed, set, reconnected, or ignored on SvelteKit 3.
 *
 * @example
 * ```ts
 * export const CreatePost = Form(PostInput, ({ data }) =>
 *   Effect.gen(function* () {
 *     yield* Posts.create(data);
 *     yield* Requested.refreshAll(GetPosts, 1);
 *   }),
 * );
 * ```
 *
 * @since 5.0.0
 */
export const Requested: RequestedFactory = Object.assign(ListRequested, {
	refreshAll: RefreshAll,
	reconnectAll: ReconnectAll,
	ignoreAll: IgnoreAll,
}) as unknown as RequestedFactory;
