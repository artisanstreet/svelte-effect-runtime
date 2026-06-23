import {
  create_remote_http_error,
  create_remote_transport_error,
  create_remote_validation_error,
  is_serialized_remote_failure_envelope,
} from "$/remote/shared.ts";
import type { FormIssue, RemoteFailure } from "$/remote/shared.ts";
import { RemoteErrorDecodeError } from "$/errors.ts";
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
export function decode_remote_error<ErrorType = never>(
  raw: unknown,
  decode?: (encoded: string) => unknown,
): RemoteFailure<ErrorType> | unknown {
  const embedded = parse_embedded_remote_failure(raw);

  if (embedded !== raw) {
    return decode_remote_error<ErrorType>(embedded, decode);
  }

  if (is_serialized_remote_failure_envelope(raw)) {
    try {
      const decoded = decode ? decode(raw.encoded) : parse(raw.encoded);

      return decoded as RemoteFailure<ErrorType>;
    } catch {
      return create_remote_transport_error(
        new RemoteErrorDecodeError(raw),
        raw,
      );
    }
  }

  return raw;
}

function parse_embedded_remote_failure(raw: unknown): unknown {
  if (typeof raw === "string") {
    return parse_json_or_original(raw);
  }

  if (typeof raw !== "object" || raw === null || !("message" in raw)) {
    return raw;
  }

  const message = (raw as { message?: unknown }).message;

  if (typeof message !== "string") {
    return raw;
  }

  const parsed = parse_json_or_original(message);

  return parsed === message ? raw : parsed;
}

function parse_json_or_original(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
): value is RemoteFailure<never> {
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
export function normalize_native_error<ErrorType = never>(
  error: unknown,
): RemoteFailure<ErrorType> {
  const body = get_error_body(error);
  const decoded = decode_remote_error<ErrorType>(body);
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
