import type { RemoteFailure } from "$/remote/shared.ts";
import type { Effect } from "effect";

import { resolve_query_result } from "./query-result.ts";
import { make_effect_from_promise } from "./effect.ts";
import { copy_property_descriptors, has_method } from "./utils.ts";
import type { NativeMethod } from "./types.ts";

type RemoteResourceEffect<Output> =
  & Effect.Effect<Output, RemoteFailure<unknown>>
  & {
    readonly current: Output | undefined;
    readonly error: unknown;
    readonly loading: boolean;
    readonly ready: boolean;
  };

type RemoteQueryEffect<Output> =
  & RemoteResourceEffect<Output>
  & {
    readonly refresh: () => Effect.Effect<void, unknown, never>;
    readonly set: (value: Output) => void;
    readonly withOverride: (
      update: (current: Output) => Output,
    ) => unknown;
  };

type RemoteLiveQueryEffect<Output> =
  & RemoteResourceEffect<Output>
  & AsyncIterable<Output>
  & {
    readonly connected: boolean;
    readonly done: boolean;
    readonly reconnect: () => Effect.Effect<void, unknown, never>;
  };

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
export function create_remote_query_adapter<Input, Output>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  _base = "",
): (input: Input) => RemoteQueryEffect<Output> {
  const load = has_method(native_factory, "load")
    ? native_factory.load
    : undefined;
  const query = typeof native_factory === "function"
    ? native_factory as NativeMethod
    : undefined;

  if (!query && !load) {
    throw new Error(
      "[INVALID_QUERY_FACTORY]: Invalid query factory: expected a function",
    );
  }

  const wrapped = ((input: Input) => {
    if (!query) {
      return make_effect_from_promise(async () => {
        const result = await load?.(input);

        return await resolve_query_result<Output>(result, decode_payload);
      }) as RemoteQueryEffect<Output>;
    }

    const resource = query(input);
    const effect = make_effect_from_promise(async () =>
      await resolve_query_result<Output>(resource, decode_payload)
    ) as RemoteQueryEffect<Output>;

    attach_query_resource(resource, effect);

    return effect;
  }) as (input: Input) => RemoteQueryEffect<Output>;

  copy_property_descriptors(native_factory, wrapped);

  return wrapped;
}

/**
 * Creates a remote live query adapter. The returned function takes input and
 * returns an `Effect` that awaits the first live value while preserving live
 * stream state and reconnect controls.
 *
 * @example
 * ```ts
 * const getTime = create_remote_live_query_adapter(nativeLive, (value) => value);
 * const time = yield* getTime();
 * ```
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native live query function.
 * @param decode_payload - Function to decode the initial response payload.
 * @param _base - Deprecated transport base retained for compatibility.
 * @returns A function returning an Effect-backed live query resource.
 * @internal
 */
export function create_remote_live_query_adapter<Input, Output>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  _base = "",
): (input: Input) => RemoteLiveQueryEffect<Output> {
  const query = typeof native_factory === "function"
    ? native_factory as NativeMethod
    : undefined;

  if (!query) {
    throw new Error(
      "[INVALID_LIVE_QUERY_FACTORY]: Invalid live query factory: expected a function",
    );
  }

  const wrapped = ((input: Input) => {
    const resource = query(input);
    const effect = make_effect_from_promise(async () =>
      await resolve_query_result<Output>(resource, decode_payload)
    ) as RemoteLiveQueryEffect<Output>;

    attach_live_query_resource(resource, effect);

    return effect;
  }) as (input: Input) => RemoteLiveQueryEffect<Output>;

  copy_property_descriptors(native_factory, wrapped);

  return wrapped;
}

function is_resource<Output>(
  resource: unknown,
): resource is NativeRemoteResource<Output> {
  const resource_type = typeof resource;

  return (
    (resource_type === "object" && resource !== null) ||
    resource_type === "function"
  );
}

function attach_resource_getters<Output>(
  resource: unknown,
  effect: RemoteResourceEffect<Output>,
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

function attach_query_resource<Output>(
  resource: unknown,
  effect: RemoteQueryEffect<Output>,
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
      value: () =>
        make_effect_from_promise(() => Promise.resolve(refresh.call(resource))),
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
      value: (update: (current: Output) => Output) =>
        with_override.call(resource, update),
    });
  }
}

function attach_live_query_resource<Output>(
  resource: unknown,
  effect: RemoteLiveQueryEffect<Output>,
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
      value: () =>
        make_effect_from_promise(() =>
          Promise.resolve(reconnect.call(resource))
        ),
    });
  }

  if (typeof async_iterator === "function") {
    Object.defineProperty(effect, Symbol.asyncIterator, {
      configurable: true,
      value: () => async_iterator.call(resource),
    });
  }
}
