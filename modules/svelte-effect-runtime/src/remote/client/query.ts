import { InvalidLiveQueryFactoryError, InvalidQueryFactoryError } from "$/errors.ts";
import { copy_property_descriptors, has_method } from "./utils.ts";
import { normalize_native_error } from "./failures.ts";
import { resolve_query_result } from "./query-result.ts";
import { MakeEffectFromPromise } from "./effect.ts";
import type { EffectRemoteQueryUpdateBrand, NativeMethod } from "./types.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { Effect } from "effect";

type RemoteInput<Input> = undefined extends Input ? Input | void : Input;

type DecodePayload<Output> = (value: unknown) => Output;

type NativeQueryFactory<Input> =
	| ((input: RemoteInput<Input>) => unknown)
	| {
			readonly load: (input: RemoteInput<Input>) => unknown;
	  };

type RemoteResourceEffect<Output, ErrorType = never> = Effect.Effect<
	Output,
	RemoteFailure<ErrorType>
> & {
	readonly current: Output | undefined;
	readonly error: unknown;
	readonly loading: boolean;
	readonly ready: boolean;
};

type RemoteResourceLike<Output, ErrorType = never> =
	| RemoteResourceEffect<Output, ErrorType>
	| RemoteLiveQueryResource<Output>;

type RemoteQueryEffect<Output, ErrorType = never> = RemoteResourceEffect<Output, ErrorType> & {
	readonly refresh: () => Effect.Effect<void, unknown, never>;
	readonly set: (value: Output) => void;
	readonly withOverride: (update: (current: Output) => Output) => unknown;
};

type RemoteLiveQueryEffect<Output, ErrorType = never> = Effect.Effect<
	RemoteLiveQueryResource<Output>,
	RemoteFailure<ErrorType>
>;

type RemoteLiveQueryResource<Output> = {
	readonly connected: boolean;
	readonly current: Output | undefined;
	readonly done: boolean;
	readonly error: unknown;
	readonly loading: boolean;
	readonly ready: boolean;
	readonly reconnect: () => Effect.Effect<void, unknown, never>;
} & AsyncIterable<Output>;

type NativeRemoteResource<Output> = {
	readonly connected?: boolean;
	readonly current?: Output;
	readonly done?: boolean;
	readonly error?: unknown;
	readonly loading?: boolean;
	readonly ready?: boolean;
	readonly reconnect?: () => Promise<void>;
	readonly refresh?: () => Promise<void>;
	readonly set?: (value: Output) => void;
	readonly withOverride?: (update: (current: Output) => Output) => unknown;
	readonly [Symbol.asyncIterator]?: () => AsyncIterator<Output>;
};

/**
 * Creates a remote query adapter. The returned function takes input and
 * returns an `Effect` that executes SvelteKit's native query function.
 *
 * @example
 * ```ts
 * const getUser = create_remote_query_adapter(nativeQuery, (value) => value);
 * const user = yield* getUser({ id: 1 });
 * ```
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native query function or a legacy
 *   response factory used by tests.
 * @param decode_payload - Function to decode the response payload.
 * @param _base - Deprecated transport base retained for compatibility.
 * @returns A function returning an Effect of the response.
 * @internal
 */
export function create_remote_query_adapter<Input, Output, ErrorType = never>(
	native_factory: NativeQueryFactory<Input>,
	decode_payload: DecodePayload<Output>,
	_base?: string,
): EffectRemoteQueryUpdateBrand &
	((input: RemoteInput<Input>) => RemoteQueryEffect<Output, ErrorType>);
export function create_remote_query_adapter<Input, Output, ErrorType = never>(
	native_factory: NativeQueryFactory<Input>,
	decode_payload: (value: unknown) => unknown,
	_base?: string,
): EffectRemoteQueryUpdateBrand &
	((input: RemoteInput<Input>) => RemoteQueryEffect<Output, ErrorType>);
export function create_remote_query_adapter<Input, Output, ErrorType = never>(
	native_factory: unknown,
	decode_payload: DecodePayload<Output>,
	_base = "",
): EffectRemoteQueryUpdateBrand &
	((input: RemoteInput<Input>) => RemoteQueryEffect<Output, ErrorType>) {
	const load = has_method(native_factory, "load") ? native_factory.load : undefined;
	const query =
		typeof native_factory === "function" ? (native_factory as NativeMethod) : undefined;

	if (!query && !load) {
		throw new InvalidQueryFactoryError();
	}

	const wrapped = ((input: RemoteInput<Input>) => {
		if (!query) {
			return MakeEffectFromPromise<Output, ErrorType>(async () => {
				const result = await load?.(input);

				return await resolve_query_result<Output>(result, decode_payload);
			}) as RemoteQueryEffect<Output, ErrorType>;
		}

		const resource = query(input);
		const QueryEffect = MakeEffectFromPromise<Output, ErrorType>(
			async () => await resolve_query_result<Output>(resource, decode_payload),
		) as RemoteQueryEffect<Output, ErrorType>;

		attach_query_resource(resource, QueryEffect);

		return QueryEffect;
	}) as EffectRemoteQueryUpdateBrand &
		((input: RemoteInput<Input>) => RemoteQueryEffect<Output, ErrorType>);

	copy_property_descriptors(native_factory, wrapped);

	return wrapped;
}

/**
 * Creates a remote live query adapter. The returned function takes input and
 * returns an `Effect` that resolves to a live query resource with stream state
 * and reconnect controls.
 *
 * @example
 * ```ts
 * const getTime = create_remote_live_query_adapter(nativeLive, (value) => value);
 * const time = yield* getTime();
 * const current = time.current;
 * ```
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native live query function.
 * @param _decode_payload - Deprecated payload decoder retained for parity with
 *   other remote adapters.
 * @param _base - Deprecated transport base retained for compatibility.
 * @returns A function returning an Effect-backed live query resource.
 * @internal
 */
export function create_remote_live_query_adapter<Input, Output, ErrorType = never>(
	native_factory: unknown,
	_decode_payload: (value: unknown) => unknown,
	_base = "",
): EffectRemoteQueryUpdateBrand &
	((input: RemoteInput<Input>) => RemoteLiveQueryEffect<Output, ErrorType>) {
	const query =
		typeof native_factory === "function" ? (native_factory as NativeMethod) : undefined;

	if (!query) {
		throw new InvalidLiveQueryFactoryError();
	}

	const wrapped = ((input: Input) =>
		Effect.try({
			try: () => {
				const resource = query(input);

				return make_live_query_resource<Output>(resource);
			},
			catch: normalize_native_error,
		}) as RemoteLiveQueryEffect<Output>) as EffectRemoteQueryUpdateBrand &
		((input: RemoteInput<Input>) => RemoteLiveQueryEffect<Output, ErrorType>);

	copy_property_descriptors(native_factory, wrapped);

	return wrapped;
}

function is_resource<Output>(resource: unknown): resource is NativeRemoteResource<Output> {
	const resource_type = typeof resource;

	return (resource_type === "object" && resource !== null) || resource_type === "function";
}

function attach_resource_getters<Output, ErrorType = never>(
	resource: unknown,
	effect: RemoteResourceLike<Output, ErrorType>,
): void {
	const methods = is_resource<Output>(resource) ? resource : undefined;
	const keys = ["current", "error", "loading", "ready"] as const;

	if (!methods) {
		return;
	}

	for (const key of keys) {
		if (!(key in methods)) {
			continue;
		}

		Object.defineProperty(effect, key, {
			configurable: true,
			get: () => methods[key],
		});
	}
}

function attach_query_resource<Output, ErrorType = never>(
	resource: unknown,
	effect: RemoteQueryEffect<Output, ErrorType>,
): void {
	const methods = is_resource<Output>(resource) ? resource : undefined;
	const refresh = methods?.refresh;
	const set = methods?.set;
	const with_override = methods?.withOverride;

	attach_resource_getters(resource, effect);

	if (!methods) {
		return;
	}

	if (typeof refresh === "function") {
		Object.defineProperty(effect, "refresh", {
			configurable: true,
			value: () => MakeEffectFromPromise(() => Promise.resolve(refresh.call(resource))),
		});
	}

	if (typeof set === "function") {
		Object.defineProperty(effect, "set", {
			configurable: true,
			value: (value: Output) => set.call(resource, value),
		});
	}

	if (typeof with_override === "function") {
		Object.defineProperty(effect, "withOverride", {
			configurable: true,
			value: (update: (current: Output) => Output) => with_override.call(resource, update),
		});
	}
}

function attach_live_query_resource<Output>(
	resource: unknown,
	effect: RemoteLiveQueryResource<Output>,
): void {
	const methods = is_resource<Output>(resource) ? resource : undefined;
	const async_iterator = methods?.[Symbol.asyncIterator];
	const reconnect = methods?.reconnect;
	const keys = ["connected", "done"] as const;

	attach_resource_getters(resource, effect);

	if (!methods) {
		return;
	}

	for (const key of keys) {
		if (!(key in methods)) {
			continue;
		}

		Object.defineProperty(effect, key, {
			configurable: true,
			get: () => methods[key],
		});
	}

	if (typeof reconnect === "function") {
		Object.defineProperty(effect, "reconnect", {
			configurable: true,
			value: () => MakeEffectFromPromise(() => Promise.resolve(reconnect.call(resource))),
		});
	}

	if (typeof async_iterator === "function") {
		Object.defineProperty(effect, Symbol.asyncIterator, {
			configurable: true,
			value: () => async_iterator.call(resource),
		});
	}
}

function make_live_query_resource<Output>(resource: unknown): RemoteLiveQueryResource<Output> {
	const live_resource = {} as RemoteLiveQueryResource<Output>;

	attach_live_query_resource(resource, live_resource);

	return live_resource;
}
