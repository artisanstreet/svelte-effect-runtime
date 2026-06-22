import { get_dispatcher } from "$/dispatcher.ts";
import { Effect } from "effect";

import { make_effect_from_promise } from "./effect.ts";
import { has_method } from "./utils.ts";
import type { EffectRemoteFormSubmit, NativeMethod } from "./types.ts";

/**
 * Wraps a remote form enhance callback so Effect return values are run.
 *
 * @since 2.0.0
 * @param callback - Native enhance callback to wrap.
 * @returns Wrapped callback or undefined.
 */
export function wrap_enhance_callback<Output, ErrorType = never>(
  callback: NativeMethod | undefined,
): NativeMethod | undefined {
  if (!callback) {
    return undefined;
  }

  return (event: unknown) => {
    const wrapped_event = wrap_submit_callback<Output, ErrorType>(event);
    const result = callback(wrapped_event);

    if (Effect.isEffect(result)) {
      return get_dispatcher().run(result);
    }

    return result;
  };
}

function wrap_submit_callback<Output, ErrorType>(event: unknown): unknown {
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
      value: () =>
        make_submit_effect<Output, ErrorType>(original_submit, event),
    },
  });
}

function make_submit_effect<Output, ErrorType>(
  original_submit: NativeMethod,
  event: unknown,
): EffectRemoteFormSubmit<Output, ErrorType> {
  let updates_args: unknown[] | undefined;

  const effect = make_effect_from_promise<Output | undefined, ErrorType>(
    async (): Promise<Output | undefined> => {
      const result = original_submit();
      const value = updates_args && has_method(result, "updates")
        ? await Promise.resolve(result.updates(...updates_args))
        : await Promise.resolve(result);

      if (typeof value === "boolean") {
        return read_submit_result<Output>(event);
      }

      return value as Output;
    },
  ) as EffectRemoteFormSubmit<Output, ErrorType>;

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

function read_submit_result<Output>(event: unknown): Output | undefined {
  if (typeof event !== "object" || event === null || !("result" in event)) {
    return undefined;
  }

  return Reflect.get(event, "result") as Output | undefined;
}
