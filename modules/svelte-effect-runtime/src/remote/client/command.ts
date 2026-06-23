import type { RemoteFailure } from "$/remote/shared.ts";
import type { Effect } from "effect";

import { InvalidCommandFactoryError } from "$/errors.ts";
import { decode_response_or_value } from "./responses.ts";
import { make_effect_from_promise } from "./effect.ts";
import { copy_property_descriptors, has_method } from "./utils.ts";
import type { NativeMethod, Pending } from "./types.ts";

type EffectRemoteCommandAdapter<Input, Output, ErrorType = never> =
  & ((
    input: undefined extends Input ? Input | void : Input,
  ) => Effect.Effect<Output, RemoteFailure<ErrorType>>)
  & {
    readonly pending: number;
  };

/**
 * Creates a remote command adapter. The adapter preserves the native
 * pending getter and turns each invocation into an Effect.
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native command function or a legacy
 *   response factory used by tests.
 * @param decode_payload - Function to decode the response payload.
 * @param _base - Deprecated transport base retained for compatibility.
 * @param pending - Optional pending counter for legacy response factories.
 * @returns A function returning an Effect of the response.
 * @internal
 */
export function create_remote_command_adapter<
  Input,
  Output,
  ErrorType = never,
>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  _base = "",
  pending?: Pending,
): EffectRemoteCommandAdapter<Input, Output, ErrorType> {
  const invoke = has_method(native_factory, "invoke")
    ? native_factory.invoke
    : undefined;

  if (typeof native_factory !== "function" && !invoke) {
    throw new InvalidCommandFactoryError();
  }

  const count = pending ?? { value: 0 };

  const adapter = (input: undefined extends Input ? Input | void : Input) =>
    make_effect_from_promise<Output, ErrorType>(async () => {
      count.value += 1;

      try {
        const result = invoke
          ? await invoke(input)
          : await (native_factory as NativeMethod)(input);

        return await decode_response_or_value<Output, ErrorType>(
          result,
          decode_payload,
        );
      } finally {
        count.value -= 1;
      }
    });

  copy_property_descriptors(native_factory, adapter);

  if (!Object.prototype.hasOwnProperty.call(adapter, "pending")) {
    Object.defineProperty(adapter, "pending", {
      get: () => count.value,
    });
  }

  return adapter as EffectRemoteCommandAdapter<Input, Output, ErrorType>;
}
