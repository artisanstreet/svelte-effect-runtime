import {
  create_remote_http_error,
  create_remote_transport_error,
  create_remote_validation_error,
  is_serialized_remote_failure_envelope,
} from "$/remote/shared.ts";
import type { FormIssue, RemoteFailure } from "$/remote/shared.ts";
import { parse } from "devalue";

/**
 * Decodes a raw wire value into a remote failure when it uses the runtime
 * failure envelope.
 *
 * @example
 * ```ts
 * const failure = decode_remote_error(body);
 * ```
 *
 * @since 2.0.0
 * @param raw - Raw value received from the network or SvelteKit error body.
 * @param decode - Optional devalue decoder for custom error payloads.
 * @returns The decoded failure/value, or a transport error when decoding fails.
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
 * @example
 * ```ts
 * if (is_decoded_remote_failure(value)) throw value;
 * ```
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value carries a `_tag` discriminator.
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
 * Checks whether a response body represents SvelteKit validation issues.
 *
 * @example
 * ```ts
 * if (is_validation_body(body)) return body.issues;
 * ```
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value contains a form issue list.
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
 * Normalizes native thrown values into the runtime's remote failure model.
 *
 * @example
 * ```ts
 * const failure = normalize_native_error(error);
 * ```
 *
 * @since 2.0.0
 * @param error - Unknown value thrown by a native remote helper.
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
