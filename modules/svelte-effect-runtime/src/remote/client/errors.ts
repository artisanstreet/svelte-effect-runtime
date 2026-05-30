import {
  create_remote_http_error,
  create_remote_transport_error,
  create_remote_validation_error,
  is_serialized_remote_failure_envelope,
} from "$/remote/shared.ts";
import type { FormIssue, RemoteFailure } from "$/remote/shared.ts";
import { Effect } from "effect";
import { parse } from "devalue";

import { has_method } from "./utils.ts";

/**
 * Decodes a raw value received over the wire into a domain failure or value.
 *
 * @since 2.0.0
 * @param raw - Raw value from network or SvelteKit `HttpError`.
 * @param decode - Optional devalue decoder.
 * @returns Decoded value or a transport error when decoding fails.
 */
export function decode_remote_error(
  raw: unknown,
  decode?: (encoded: string) => unknown,
): RemoteFailure<unknown> | unknown {
  if (is_serialized_remote_failure_envelope(raw)) {
    try {
      const decoded = decode ? decode(raw.encoded) : parse(raw.encoded);

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
 * Checks whether a decoded value is a tagged remote failure.
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value has a `_tag` discriminator.
 */
export function is_decoded_remote_failure(
  value: unknown,
): value is RemoteFailure<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value
  );
}

/**
 * Checks whether a value is a SvelteKit validation issue body.
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value contains form issues.
 */
export function is_validation_body(
  value: unknown,
): value is { issues: readonly FormIssue[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { issues?: unknown }).issues)
  );
}

/**
 * Decodes a failed `Response` into the runtime failure model.
 *
 * @since 2.0.0
 * @param response - Failed fetch response.
 * @returns Remote failure represented by the response.
 */
export async function decode_response_failure(
  response: Response,
): Promise<RemoteFailure<unknown>> {
  const body = await response.json().catch(() => undefined);
  const decoded = decode_remote_error(body);

  if (is_decoded_remote_failure(decoded)) {
    return decoded;
  }

  if (response.status === 400 && is_validation_body(body)) {
    return create_remote_validation_error(body.issues, body, response.status);
  }

  return create_remote_http_error(response.status, body);
}

/**
 * Normalizes thrown native remote errors into the runtime failure model.
 *
 * @since 2.0.0
 * @param error - Unknown thrown error value.
 * @returns A typed remote failure.
 */
export function normalize_native_error(error: unknown): RemoteFailure<unknown> {
  const body = get_error_body(error);
  const decoded = decode_remote_error(body);
  const status = get_error_status(error);

  if (is_decoded_remote_failure(decoded)) {
    return decoded;
  }

  if (status === 400 && is_validation_body(body)) {
    return create_remote_validation_error(body.issues, body, status);
  }

  if (status !== undefined) {
    return create_remote_http_error(status, body, error);
  }

  return create_remote_transport_error(error);
}

/**
 * Decodes either a raw value or `Response` returned by a native remote helper.
 *
 * @since 2.0.0
 * @param value - Native result value.
 * @param decode_payload - Function to decode successful payloads.
 * @returns Decoded successful output.
 */
export async function decode_response_or_value<Output>(
  value: unknown,
  decode_payload: (value: unknown) => unknown,
): Promise<Output> {
  if (value instanceof Response) {
    if (!value.ok) {
      throw await decode_response_failure(value);
    }

    const data = await value.json();

    return decode_payload(data) as Output;
  }

  return decode_payload(value) as Output;
}

/**
 * Resolves native query results, including SvelteKit run handles.
 *
 * @since 2.0.0
 * @param value - Native query result or handle.
 * @param decode_payload - Function to decode successful payloads.
 * @returns Decoded query output.
 */
export async function resolve_query_result<Output>(
  value: unknown,
  decode_payload: (value: unknown) => unknown,
): Promise<Output> {
  if (has_method(value, "run")) {
    const result = await value.run();

    return decode_response_or_value(result, decode_payload);
  }

  const result = await Promise.resolve(value);

  return decode_response_or_value(result, decode_payload);
}

/**
 * Wraps a promise-producing operation in an Effect with remote error mapping.
 *
 * @since 2.0.0
 * @param run - Promise-producing operation.
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

function get_error_status(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;

  return typeof status === "number" ? status : undefined;
}

function get_error_body(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if ("body" in error) {
    return (error as { body?: unknown }).body;
  }

  if ("data" in error) {
    return (error as { data?: unknown }).data;
  }

  return undefined;
}
