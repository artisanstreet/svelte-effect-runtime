import { get_dispatcher } from "$/dispatcher.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { Effect } from "effect";

import { make_effect_from_promise } from "./effect.ts";
import { has_method } from "./utils.ts";
import type { NativeMethod } from "./types.ts";

/**
 * Wraps a remote form enhance callback so Effect return values are run.
 *
 * @since 2.0.0
 * @param callback - Native enhance callback to wrap.
 * @returns Wrapped callback or undefined.
 */
export function wrap_enhance_callback(
  callback: NativeMethod | undefined,
): NativeMethod | undefined {
  if (!callback) {
    return undefined;
  }

  return (event: unknown) => {
    const wrapped_event = wrap_submit_callback(event);
    const result = callback(wrapped_event);

    if (Effect.isEffect(result)) {
      return get_dispatcher().run(result);
    }

    return result;
  };
}

function wrap_submit_callback(event: unknown): unknown {
  if (
    typeof event !== "object" || event === null || !has_method(event, "submit")
  ) {
    return event;
  }

  const original_submit = event.submit;
  const { submit: _submit, ...descriptors } = Object.getOwnPropertyDescriptors(
    event,
  );

  void _submit;

  return Object.defineProperties({}, {
    ...descriptors,
    submit: {
      configurable: true,
      enumerable: false,
      value: () => make_submit_effect(original_submit),
    },
  });
}

function make_submit_effect(
  original_submit: NativeMethod,
): Effect.Effect<boolean, RemoteFailure<unknown>> & Record<string, unknown> {
  let updates_args: unknown[] | undefined;

  const effect = make_effect_from_promise(async () => {
    const result = original_submit();

    if (updates_args && has_method(result, "updates")) {
      return await Promise.resolve(result.updates(...updates_args));
    }

    return await Promise.resolve(result);
  }) as
    & Effect.Effect<boolean, RemoteFailure<unknown>>
    & Record<string, unknown>;

  Object.defineProperty(effect, "updates", {
    configurable: true,
    enumerable: false,
    value: (...args: unknown[]) => {
      updates_args ??= args;

      return effect;
    },
  });

  return effect;
}
