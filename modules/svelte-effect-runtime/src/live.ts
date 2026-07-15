import { create_remote_transport_error } from "$/remote/shared.ts";
import { InvalidLiveQueryFactoryError } from "$/errors.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { Effect, Stream } from "effect";

/** Brands remote live streams without relying on class identity. */
const remote_live_stream: unique symbol = Symbol.for("ser.remote-live-stream") as never;

const live_metadata: unique symbol = Symbol.for("ser.remote-live-metadata") as never;

const live_operator: unique symbol = Symbol.for("ser.live-operator") as never;

type RemoteLivePipe<A, E> = {
	(): RemoteLiveStream<A, E>;
	(ab: LiveFactory["status"]): Stream.Stream<LiveStatus, never, never>;
	(ab: LiveFactory["reconnect"]): Effect.Effect<void, RemoteFailure<E>, never>;
	<B>(ab: LiveFactory["status"], bc: (_: Stream.Stream<LiveStatus, never, never>) => B): B;
	<B>(
		ab: LiveFactory["reconnect"],
		bc: (_: Effect.Effect<void, RemoteFailure<E>, never>) => B,
	): B;
	<B, C>(
		ab: LiveFactory["status"],
		bc: (_: Stream.Stream<LiveStatus, never, never>) => B,
		cd: (_: B) => C,
	): C;
	<B, C>(
		ab: LiveFactory["reconnect"],
		bc: (_: Effect.Effect<void, RemoteFailure<E>, never>) => B,
		cd: (_: B) => C,
	): C;
	<B>(
		ab: (
			_: Stream.Stream<A, RemoteFailure<E>, never>,
		) => Stream.Stream<B, RemoteFailure<E>, never>,
	): RemoteLiveStream<B, E>;
	<B>(ab: (_: Stream.Stream<A, RemoteFailure<E>, never>) => B): B;
	<B, C>(ab: (_: Stream.Stream<A, RemoteFailure<E>, never>) => B, bc: (_: B) => C): C;
	<B, C, D>(
		ab: (_: Stream.Stream<A, RemoteFailure<E>, never>) => B,
		bc: (_: B) => C,
		cd: (_: C) => D,
	): D;
};

/**
 * Stream returned by `Query.live` remote functions.
 *
 * @example
 * ```ts
 * const Time = GetTime();
 * const Label = Time.pipe(Stream.map((time) => time.toISOString()));
 * ```
 *
 * @since 3.4.8
 */
export type RemoteLiveStream<A, E = never> = Omit<
	Stream.Stream<A, RemoteFailure<E>, never>,
	"pipe"
> & {
	readonly [remote_live_stream]: true;
	readonly pipe: RemoteLivePipe<A, E>;
};

/**
 * Transport state exposed separately from the data stream.
 *
 * @example
 * ```ts
 * const Status = GetTime().pipe(Live.status);
 * ```
 *
 * @since 3.4.8
 */
export type LiveStatus =
	| {
			readonly _tag: "Idle";
	  }
	| {
			readonly _tag: "Connecting";
	  }
	| {
			readonly _tag: "Open";
	  }
	| {
			readonly _tag: "Failed";
			readonly cause: unknown;
	  }
	| {
			readonly _tag: "Closed";
	  };

/**
 * Public live stream control helpers.
 *
 * @example
 * ```ts
 * yield* GetNotifications().pipe(Live.reconnect);
 * ```
 *
 * @since 3.4.8
 */
export interface LiveFactory {
	readonly status: {
		readonly [live_operator]: true;
		/**
		 * Creates a stream of transport status updates for a remote live stream.
		 *
		 * @example
		 * ```ts
		 * const Status = GetTime().pipe(Live.status);
		 * ```
		 *
		 * @param stream - Remote live stream whose transport status should be read.
		 * @returns A stream of transport status snapshots.
		 */
		<A, E>(stream: RemoteLiveStream<A, E>): Stream.Stream<LiveStatus, never, never>;
	};
	readonly reconnect: {
		readonly [live_operator]: true;
		/**
		 * Reconnects the transport behind a remote live stream.
		 *
		 * @example
		 * ```ts
		 * yield* GetNotifications().pipe(Live.reconnect);
		 * ```
		 *
		 * @param stream - Remote live stream whose transport should reconnect.
		 * @returns An Effect that completes after the reconnect request is sent.
		 */
		<A, E>(stream: RemoteLiveStream<A, E>): Effect.Effect<void, RemoteFailure<E>, never>;
	};
}

type NativeLiveResource<A> = {
	readonly connected?: boolean;
	readonly current?: A;
	readonly done?: boolean;
	readonly error?: unknown;
	readonly loading?: boolean;
	readonly ready?: boolean;
	readonly reconnect?: () => Promise<void> | void;
	readonly then?: PromiseLike<A>["then"];
	readonly [Symbol.asyncIterator]?: () => AsyncIterator<A>;
};

type NativeThenableLiveResource<A> = NativeLiveResource<A> & AsyncIterable<A> & PromiseLike<A>;

type LiveMetadata<A = unknown, ErrorType = never> = {
	readonly resource: NativeLiveResource<A>;
	readonly on_error: (error: unknown) => RemoteFailure<ErrorType>;
};

type LiveMetadataCarrier = {
	readonly [live_metadata]?: LiveMetadata<unknown, unknown>;
};

type PipeableStream<A, E, R> = Stream.Stream<A, E, R> & {
	readonly pipe: (...args: readonly unknown[]) => unknown;
};

export function make_remote_live_stream<A, ErrorType = never>(
	resource: unknown,
	on_error: (error: unknown) => RemoteFailure<ErrorType>,
): RemoteLiveStream<A, ErrorType> {
	const live_resource = as_native_live_resource<A>(resource);
	const stream = make_live_stream(live_resource, on_error);
	const metadata: LiveMetadata<A, ErrorType> = {
		resource: live_resource,
		on_error,
	};

	return attach_live_metadata(stream, metadata) as RemoteLiveStream<A, ErrorType>;
}

function make_live_stream<A, ErrorType>(
	resource: NativeLiveResource<A> & AsyncIterable<A>,
	on_error: (error: unknown) => RemoteFailure<ErrorType>,
): Stream.Stream<A, RemoteFailure<ErrorType>, never> {
	const source = is_thenable_live_resource(resource)
		? make_cached_live_iterable(resource)
		: resource;

	return Stream.fromAsyncIterable(source, on_error);
}

function make_cached_live_iterable<A>(resource: NativeThenableLiveResource<A>): AsyncIterable<A> {
	return {
		async *[Symbol.asyncIterator]() {
			const initial_value = await resource;
			let is_first_update = true;

			yield initial_value;

			for await (const value of resource) {
				/** Native iterators seed their latest value after the cached initial value. */
				if (is_first_update && Object.is(value, initial_value)) {
					is_first_update = false;

					continue;
				}

				is_first_update = false;

				yield value;
			}
		},
	};
}

function is_thenable_live_resource<A>(
	resource: NativeLiveResource<A> & AsyncIterable<A>,
): resource is NativeThenableLiveResource<A> {
	return typeof resource.then === "function";
}

export function make_failed_remote_live_stream<A, ErrorType = never>(
	error: unknown,
	on_error: (error: unknown) => RemoteFailure<ErrorType>,
): RemoteLiveStream<A, ErrorType> {
	const failure = on_error(error);
	const resource: NativeLiveResource<A> & AsyncIterable<A> = {
		connected: false,
		done: true,
		error: failure,
		[Symbol.asyncIterator]: () => ({
			next: () => Promise.reject(failure),
		}),
	};
	const metadata: LiveMetadata<A, ErrorType> = {
		resource,
		on_error,
	};
	const stream = Stream.fail(failure);

	return attach_live_metadata(stream, metadata) as unknown as RemoteLiveStream<A, ErrorType>;
}

const LiveStatusStream = Object.assign(
	function status<A, E>(stream: RemoteLiveStream<A, E>): Stream.Stream<LiveStatus, never, never> {
		return Stream.unwrap(
			Effect.sync(() => {
				const metadata = get_live_metadata(stream);

				if (!metadata) {
					return Stream.succeed({ _tag: "Idle" } as const);
				}

				return Stream.succeed(read_live_status(metadata.resource)).pipe(
					Stream.concat(
						Stream.tick("250 millis").pipe(
							Stream.map(() => read_live_status(metadata.resource)),
						),
					),
				);
			}),
		);
	},
	{ [live_operator]: true as const },
) satisfies LiveFactory["status"];

const LiveReconnect = Object.assign(
	function reconnect<A, E>(
		stream: RemoteLiveStream<A, E>,
	): Effect.Effect<void, RemoteFailure<E>, never> {
		return Effect.gen(function* () {
			const metadata = get_live_metadata(stream);
			const reconnect = metadata?.resource.reconnect;

			if (!metadata || typeof reconnect !== "function") {
				return yield* Effect.fail(
					create_remote_transport_error(new InvalidLiveQueryFactoryError()),
				);
			}

			yield* Effect.tryPromise({
				try: () => Promise.resolve(reconnect.call(metadata.resource)),
				catch: metadata.on_error,
			});
		});
	},
	{ [live_operator]: true as const },
) satisfies LiveFactory["reconnect"];

/**
 * Remote live transport helpers.
 *
 * @since 3.4.8
 */
export const Live: LiveFactory = {
	status: LiveStatusStream,
	reconnect: LiveReconnect,
};

function as_native_live_resource<A>(resource: unknown): NativeLiveResource<A> & AsyncIterable<A> {
	if (!is_native_live_resource<A>(resource)) {
		throw new InvalidLiveQueryFactoryError();
	}

	return resource;
}

function is_native_live_resource<A>(
	resource: unknown,
): resource is NativeLiveResource<A> & AsyncIterable<A> {
	const resource_type = typeof resource;

	if (resource_type !== "object" && resource_type !== "function") {
		return false;
	}

	if (resource === null) {
		return false;
	}

	return typeof (resource as NativeLiveResource<A>)[Symbol.asyncIterator] === "function";
}

function attach_live_metadata<A, E, R>(
	stream: Stream.Stream<A, E, R>,
	metadata: LiveMetadata<unknown, unknown>,
): Stream.Stream<A, E, R> {
	const carrier = stream as Stream.Stream<A, E, R> & LiveMetadataCarrier;

	if (carrier[live_metadata]) {
		return stream;
	}

	Object.defineProperty(carrier, live_metadata, {
		configurable: true,
		value: metadata,
	});

	Object.defineProperty(carrier, remote_live_stream, {
		configurable: true,
		value: true,
	});

	propagate_live_metadata_through_pipe(carrier as PipeableStream<A, E, R>, metadata);

	return stream;
}

function propagate_live_metadata_through_pipe<A, E, R>(
	stream: PipeableStream<A, E, R>,
	metadata: LiveMetadata<unknown, unknown>,
): void {
	const pipe = stream.pipe.bind(stream);

	Object.defineProperty(stream, "pipe", {
		configurable: true,
		value: (...args: readonly unknown[]) => {
			const result = pipe(...args);

			if (Stream.isStream(result)) {
				return attach_live_metadata(result, metadata);
			}

			return result;
		},
	});
}

function get_live_metadata<A, E>(stream: RemoteLiveStream<A, E>): LiveMetadata<A, E> | undefined;
function get_live_metadata(
	stream: Stream.Stream<unknown, unknown, unknown>,
): LiveMetadata<unknown, unknown> | undefined;
function get_live_metadata(
	stream: Stream.Stream<unknown, unknown, unknown>,
): LiveMetadata<unknown, unknown> | undefined {
	return (stream as LiveMetadataCarrier)[live_metadata];
}

function read_live_status(resource: NativeLiveResource<unknown>): LiveStatus {
	if (resource.error !== undefined) {
		return {
			_tag: "Failed",
			cause: resource.error,
		};
	}

	if (resource.done === true) {
		return { _tag: "Closed" };
	}

	if (resource.connected === true) {
		return { _tag: "Open" };
	}

	return { _tag: "Connecting" };
}
