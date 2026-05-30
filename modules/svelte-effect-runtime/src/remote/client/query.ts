import type { RemoteFailure } from "$/remote/shared.ts";
import type { Effect } from "effect";

import { make_effect_from_promise, resolve_query_result } from "./errors.ts";
import { has_method } from "./utils.ts";
import type { NativeMethod } from "./types.ts";

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
): (input: Input) => Effect.Effect<Output, RemoteFailure<unknown>> {
  const load = has_method(native_factory, "load")
    ? native_factory.load
    : undefined;
  const query = typeof native_factory === "function"
    ? native_factory as NativeMethod
    : undefined;

  if (!query && !load) {
    throw new Error("Invalid query factory: expected a function");
  }

  return (input: Input) =>
    make_effect_from_promise(async () => {
      const result = query ? query(input) : await load?.(input);

      return await resolve_query_result<Output>(result, decode_payload);
    });
}
