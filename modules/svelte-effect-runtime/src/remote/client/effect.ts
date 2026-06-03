import type { RemoteFailure } from "$/remote/shared.ts";
import { Effect } from "effect";

import {
  is_decoded_remote_failure,
  normalize_native_error,
} from "./failures.ts";

/**
 * Wraps a promise-producing remote operation in an Effect with failure mapping.
 *
 * @example
 * ```ts
 * const program = make_effect_from_promise(() => native_remote(input));
 * ```
 *
 * @since 2.0.0
 * @param run - Promise-producing operation that invokes a native remote helper.
 * @returns Effect that maps thrown values into remote failures.
 */
export function make_effect_from_promise<Output>(
  run: () => Promise<Output>,
): Effect.Effect<Output, RemoteFailure<unknown>> {
  return Effect.tryPromise({
    try: run,
    catch: (error: unknown) => {
      if (is_decoded_remote_failure(error)) {
        return error;
      }

      return normalize_native_error(error);
    },
  }) as Effect.Effect<Output, RemoteFailure<unknown>>;
}
