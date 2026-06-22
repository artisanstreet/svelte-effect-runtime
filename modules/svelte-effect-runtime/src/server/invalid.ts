import { create_form_error } from "$/remote/shared.ts";
import { Effect } from "effect";
import type { FormIssue } from "$/remote/shared.ts";

import type { FormInvalid } from "./types.ts";

/**
 * Creates a path-aware proxy for remote form validation failures.
 *
 * @since 2.0.0
 * @param path - Current nested form path.
 * @returns Callable invalid proxy for this path.
 */
export function make_invalid_proxy<Input = unknown>(
  path: readonly (string | number)[] = [],
): FormInvalid<Input> {
  const invalid_at_path = (message: string) =>
    Effect.fail(
      create_form_error([{ message, path: [...path] } satisfies FormIssue]),
    );

  return new Proxy(invalid_at_path, {
    get(_target, property) {
      if (typeof property === "symbol") {
        return undefined;
      }

      return make_invalid_proxy([...path, property]);
    },
  }) as FormInvalid<Input>;
}
