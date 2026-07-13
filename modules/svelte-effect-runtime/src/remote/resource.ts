import { FailWithRemoteError, normalize_remote_effect_error } from "./effect.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { Result, type Effect } from "effect";

export type RemoteResourceEffect<Output, ErrorType = never> = Effect.Effect<
	Output,
	RemoteFailure<ErrorType>
> & {
	readonly current: Output | undefined;
	readonly error: unknown;
	readonly loading: boolean;
	readonly ready: boolean;
};

type RemoteQueryResourceEffect<Output, ErrorType = never> = RemoteResourceEffect<
	Output,
	ErrorType
> & {
	readonly refresh: () => Effect.Effect<void, unknown, never>;
	readonly set: (value: Output) => void;
	readonly withOverride: (update: (current: Output) => Output) => unknown;
};

export type NativeRemoteResource<Output> = {
	readonly current?: Output;
	readonly error?: unknown;
	readonly loading?: boolean;
	readonly ready?: boolean;
};

export function is_remote_resource<Output>(
	resource: unknown,
): resource is NativeRemoteResource<Output> {
	const resource_type = typeof resource;

	return (resource_type === "object" && resource !== null) || resource_type === "function";
}

export function attach_remote_resource_getters<Output, ErrorType = never>(
	resource: unknown,
	effect: RemoteResourceEffect<Output, ErrorType>,
): void {
	const methods = is_remote_resource<Output>(resource) ? resource : undefined;
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

export function attach_failed_remote_resource_getters<Output, ErrorType = never>(
	error: unknown,
	effect: RemoteResourceEffect<Output, ErrorType>,
): void {
	const normalized_error = normalize_remote_resource_error<ErrorType>(error);

	Object.defineProperties(effect, {
		current: {
			configurable: true,
			get: () => undefined,
		},
		error: {
			configurable: true,
			get: () => normalized_error,
		},
		loading: {
			configurable: true,
			get: () => false,
		},
		ready: {
			configurable: true,
			get: () => false,
		},
	});
}

export function attach_failed_remote_query_resource<Output, ErrorType = never>(
	error: unknown,
	effect: RemoteQueryResourceEffect<Output, ErrorType>,
): void {
	const normalized_error = normalize_remote_resource_error<ErrorType>(error);
	const RefreshFailedResource = () => FailWithRemoteError<ErrorType>(error);
	const throw_resource_error = (): never => {
		throw normalized_error;
	};

	attach_failed_remote_resource_getters(normalized_error, effect);

	Object.defineProperties(effect, {
		refresh: {
			configurable: true,
			value: RefreshFailedResource,
		},
		set: {
			configurable: true,
			value: throw_resource_error,
		},
		withOverride: {
			configurable: true,
			value: throw_resource_error,
		},
	});
}

export function normalize_remote_resource_error<ErrorType>(error: unknown): unknown {
	const normalized = Result.try(() => normalize_remote_effect_error<ErrorType>(error));

	return Result.isSuccess(normalized) ? normalized.success : error;
}
