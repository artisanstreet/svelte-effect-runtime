import {
	attach_failed_remote_query_resource,
	attach_remote_resource_getters,
	is_remote_resource,
	type NativeRemoteResource,
	type RemoteResourceEffect,
} from "$/remote/resource.ts";
import {
	make_failed_remote_live_stream,
	make_remote_live_stream,
	type RemoteLiveStream,
} from "$/live.ts";
import { InvalidLiveQueryFactoryError, InvalidQueryFactoryError } from "$/errors.ts";
import { FailWithRemoteError, MakeEffectFromPromise } from "$/remote/effect.ts";
import { attach_native_remote_query_update } from "$/remote/query-update.ts";
import type { EffectRemoteQueryUpdateBrand, NativeMethod } from "./types.ts";
import { copy_property_descriptors, has_method } from "./utils.ts";
import { normalize_native_error } from "$/remote/failures.ts";
import { ResolveQueryResult } from "./query-result.ts";
import { Effect, Result } from "effect";

type RemoteInput<Input> = undefined extends Input ? Input | void : Input;

type DecodePayload<Output> = (value: unknown) => Output;

type QueryAdapterMode = "standard" | "batch";

type NativeQueryFactory<Input> =
	| ((input: RemoteInput<Input>) => unknown)
	| {
			readonly load: (input: RemoteInput<Input>) => unknown;
	  };

type RemoteQueryEffect<Output, ErrorType = never> = EffectRemoteQueryUpdateBrand &
	RemoteResourceEffect<Output, ErrorType> & {
		readonly refresh: () => Effect.Effect<void, unknown, never>;
		readonly set: (value: Output) => void;
		readonly withOverride: (update: (current: Output) => Output) => unknown;
	};

type NativeQueryResource<Output> = NativeRemoteResource<Output> & {
	readonly refresh?: () => Promise<void>;
	readonly set?: (value: Output) => void;
	readonly withOverride?: (update: (current: Output) => Output) => unknown;
};

/** Adapts a generated SvelteKit query to SER's Effect-based client ABI. */
export function create_remote_query_adapter<Input, Output, ErrorType = never>(
	native_factory: NativeQueryFactory<Input>,
	decode_payload: DecodePayload<Output>,
	_base?: string,
	mode?: QueryAdapterMode,
): EffectRemoteQueryUpdateBrand &
	((input: RemoteInput<Input>) => RemoteQueryEffect<Output, ErrorType>);
export function create_remote_query_adapter<Input, Output, ErrorType = never>(
	native_factory: NativeQueryFactory<Input>,
	decode_payload: (value: unknown) => unknown,
	_base?: string,
	mode?: QueryAdapterMode,
): EffectRemoteQueryUpdateBrand &
	((input: RemoteInput<Input>) => RemoteQueryEffect<Output, ErrorType>);
export function create_remote_query_adapter<Input, Output, ErrorType = never>(
	native_factory: unknown,
	decode_payload: DecodePayload<Output>,
	_base = "",
	mode: QueryAdapterMode = "standard",
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
			return Effect.gen(function* () {
				const result = yield* MakeEffectFromPromise<unknown, ErrorType>(() =>
					Promise.resolve(load?.call(native_factory, input)),
				);

				return yield* ResolveQueryResult<Output, ErrorType>(result, decode_payload);
			}) as RemoteQueryEffect<Output, ErrorType>;
		}

		const resource_attempt = Result.try(() => query(input));

		if (Result.isFailure(resource_attempt)) {
			const QueryEffect = FailWithRemoteError<ErrorType>(
				resource_attempt.failure,
			) as unknown as RemoteQueryEffect<Output, ErrorType>;

			attach_failed_remote_query_resource(resource_attempt.failure, QueryEffect);

			return QueryEffect;
		}

		const resource = resource_attempt.success;
		const query_result = mode === "batch" ? begin_batch_query_result(resource) : resource;
		const QueryEffect = ResolveQueryResult<Output, ErrorType>(
			query_result,
			decode_payload,
		) as RemoteQueryEffect<Output, ErrorType>;

		attach_native_remote_query_update(QueryEffect, resource);
		attach_query_resource(resource, QueryEffect);

		return QueryEffect;
	}) as EffectRemoteQueryUpdateBrand &
		((input: RemoteInput<Input>) => RemoteQueryEffect<Output, ErrorType>);

	copy_property_descriptors(native_factory, wrapped);
	attach_native_remote_query_update(wrapped, native_factory);

	return wrapped;
}

function begin_batch_query_result(resource: unknown): unknown {
	if (!has_method(resource, "then")) {
		return resource;
	}

	const result = Promise.resolve(resource);

	void result.catch(() => {});

	return result;
}

/** Adapts a generated SvelteKit live query to SER's Effect-based client ABI. */
export function create_remote_live_query_adapter<Input, Output, ErrorType = never>(
	native_factory: unknown,
	_decode_payload: (value: unknown) => unknown,
	_base = "",
): EffectRemoteQueryUpdateBrand &
	((input: RemoteInput<Input>) => RemoteLiveStream<Output, ErrorType>) {
	const query =
		typeof native_factory === "function" ? (native_factory as NativeMethod) : undefined;

	if (!query) {
		throw new InvalidLiveQueryFactoryError();
	}

	const wrapped = ((input: Input) => {
		const resource_attempt = Result.try(() => query(input));

		if (Result.isFailure(resource_attempt)) {
			return make_failed_remote_live_stream<Output, ErrorType>(
				resource_attempt.failure,
				normalize_native_error,
			);
		}

		const resource = resource_attempt.success;

		const stream = make_remote_live_stream<Output, ErrorType>(resource, normalize_native_error);

		attach_native_remote_query_update(stream, resource);

		return stream;
	}) as EffectRemoteQueryUpdateBrand &
		((input: RemoteInput<Input>) => RemoteLiveStream<Output, ErrorType>);

	copy_property_descriptors(native_factory, wrapped);
	attach_native_remote_query_update(wrapped, native_factory);

	return wrapped;
}

function attach_query_resource<Output, ErrorType = never>(
	resource: unknown,
	effect: RemoteQueryEffect<Output, ErrorType>,
): void {
	const methods = is_remote_resource<Output>(resource)
		? (resource as NativeQueryResource<Output>)
		: undefined;
	const refresh = methods?.refresh;
	const set = methods?.set;
	const with_override = methods?.withOverride;

	attach_remote_resource_getters(resource, effect);

	if (!methods) {
		return;
	}

	if (typeof refresh === "function") {
		Object.defineProperty(effect, "refresh", {
			configurable: true,
			value: () => RefreshRemoteResource(resource, refresh),
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

const RefreshRemoteResource = (resource: unknown, refresh: () => Promise<void>) =>
	Effect.gen(function* () {
		yield* MakeEffectFromPromise(() => Promise.resolve(refresh.call(resource)));
	});
