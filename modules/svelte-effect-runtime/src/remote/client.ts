import { Effect } from "effect";
import {
  type RemoteFailure,
  type FormError,
  type FormIssue,
  REMOTE_ERROR_DECODER,
  EFFECT_REMOTE_ERROR_MARKER,
  is_serialized_remote_failure_envelope,
  is_form_error,
  create_remote_http_error,
  create_remote_transport_error,
} from "$/remote/shared.ts";

/**
 * Decodes a raw value received over the wire into either the domain
 * value or a typed `RemoteFailure`. If the value carries the remote-error
 * marker it is deserialised; otherwise it is returned as-is.
 *
 * @since 2.0.0
 * @param raw - The raw value from the network response.
 * @param decode - Optional devalue decoder function.
 * @returns The decoded value or a RemoteFailure error shape.
 */
function decode_remote_error(
  raw: unknown,
  decode?: (encoded: string) => unknown,
): RemoteFailure<unknown> | unknown {
  if (is_serialized_remote_failure_envelope(raw)) {
    try {
      const decoded = decode ? decode(raw.encoded) : JSON.parse(raw.encoded);
      return decoded as RemoteFailure<unknown>;
    } catch {
      return create_remote_transport_error(
        new Error("Failed to decode remote error payload"),
        raw,
      );
    }
  }

  return raw;
}

/**
 * Represents a pending operation counter that remote command adapters
 * use to track in-flight requests.
 *
 * @since 2.0.0
 */
export interface Pending {
  /** Current count of in-flight requests. */
  value: number;
}

/**
 * Creates a remote query adapter. The returned function takes input and
 * returns an `Effect` that performs the HTTP call and decodes the response.
 *
 * @example
 * ```ts
 * const getUser = create_remote_query_adapter(
 *   nativeQueryFactory,
 *   decodePayload,
 *   { base: "/_server" },
 * );
 *
 * const effect = getUser({ id: 1 }); // Effect<user, RemoteFailure<DomainError>>
 * ```
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native query factory.
 * @param decode_payload - Function to decode the response payload.
 * @param base - The base path for SvelteKit server endpoints.
 * @returns A function returning an Effect of the response.
 */
export function create_remote_query_adapter<Input, Output>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  base: string,
): (input: Input) => Effect.Effect<Output, RemoteFailure<unknown>> {

  const call = (native_factory as Record<string, unknown>).load as
    | ((input: Input) => Promise<Response>)
    | undefined;

  if (!call || typeof call !== "function") {
    throw new Error("Invalid query factory: missing .load method");
  }

  return (input: Input) =>

    Effect.async<Output, RemoteFailure<unknown>>((resume) => {
      void (async () => {
        try {
          const response = await call(input);

          if (!response.ok) {
            const body = await response.json().catch(() => undefined);
            resume(
              Effect.fail(
                decode_remote_error(body, decode_payload as (s: string) => unknown) as
                  RemoteFailure<unknown>,
              ),
            );
            return;
          }

          const data = await response.json();
          const decoded = decode_payload(data) as Output;
          resume(Effect.succeed(decoded));
        } catch (err: unknown) {
          resume(
            Effect.fail(create_remote_transport_error(err)),
          );
        }
      })();
    });
}

/**
 * Creates a remote command adapter. Similar to query but tracks
 * pending request count and supports mutation semantics.
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native command factory.
 * @param decode_payload - Function to decode the response payload.
 * @param base - The base path for SvelteKit server endpoints.
 * @param pending - Optional pending counter for tracking in-flight requests.
 * @returns A function returning an Effect of the response.
 */
export function create_remote_command_adapter<Input, Output>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  base: string,
  pending?: Pending,
): (input: Input) => Effect.Effect<Output, RemoteFailure<unknown>> {

  const call = (native_factory as Record<string, unknown>).invoke as
    | ((input: Input) => Promise<Response>)
    | undefined;

  if (!call || typeof call !== "function") {
    throw new Error("Invalid command factory: missing .invoke method");
  }

  const count = pending ?? { value: 0 };

  return (input: Input) =>

    Effect.async<Output, RemoteFailure<unknown>>((resume) => {
      count.value += 1;

      void (async () => {
        try {
          const response = await call(input);

          if (!response.ok) {
            const body = await response.json().catch(() => undefined);
            resume(
              Effect.fail(
                decode_remote_error(body, decode_payload as (s: string) => unknown) as
                  RemoteFailure<unknown>,
              ),
            );
            return;
          }

          const data = await response.json();
          const decoded = decode_payload(data) as Output;
          resume(Effect.succeed(decoded));
        } catch (err: unknown) {
          resume(
            Effect.fail(create_remote_transport_error(err)),
          );
        } finally {
          count.value -= 1;
        }
      })();
    });
}

/**
 * Creates a remote form adapter. Wraps SvelteKit's native form object
 * so that `.submit()` and `.validate()` return `Effect` values instead
 * of raw Promises.
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native form factory.
 * @param decode_payload - Function to decode the response payload.
 * @param base - The base path for SvelteKit server endpoints.
 * @returns An enhanced form object with Effect-returning methods.
 */
export function create_remote_form_adapter<Input, Output>(
  native_factory: unknown,
  decode_payload: (value: unknown) => unknown,
  base: string,
): Record<string, unknown> {

  const form_obj = native_factory as Record<string, unknown>;

  /** Wrap .submit() to return an Effect. */
  const original_submit = form_obj.submit as
    | ((input: Input) => Promise<Response>)
    | undefined;

  if (original_submit) {
    form_obj.submit = (input: Input) =>

      Effect.async<Output, RemoteFailure<unknown>>((resume) => {
        void (async () => {
          try {
            const response = await original_submit(input);

            if (!response.ok) {
              const body = await response.json().catch(() => undefined);
              resume(
                Effect.fail(
                  decode_remote_error(body, decode_payload as (s: string) => unknown) as
                    RemoteFailure<unknown>,
                ),
              );
              return;
            }

            const data = await response.json();
            const decoded = decode_payload(data) as Output;
            resume(Effect.succeed(decoded));
          } catch (err: unknown) {
            resume(
              Effect.fail(create_remote_transport_error(err)),
            );
          }
        })();
      }) as unknown;
  }

  /** Wrap .validate() to return an Effect. */
  const original_validate = form_obj.validate as
    | ((opts?: Record<string, unknown>) => Promise<{ issues?: readonly FormIssue[]; valid: boolean }>)
    | undefined;

  if (original_validate) {
    form_obj.validate = (opts?: Record<string, unknown>) =>

      Effect.async<{ issues?: readonly FormIssue[]; valid: boolean }, RemoteFailure<unknown>>(
        (resume) => {
          void (async () => {
            try {
              const result = await original_validate(opts);
              resume(Effect.succeed(result));
            } catch (err: unknown) {
              resume(
                Effect.fail(create_remote_transport_error(err)),
              );
            }
          })();
        },
      ) as unknown;
  }

  return form_obj;
}
