/**
 * Shared types, markers, and constructors used by both the client-side remote
 * adapters and the server-side handler runtime. These types define the error
 * protocol that flows across the network boundary.
 *
 * @since 2.0.0
 */

/**
 * Well-known marker injected into every serialised remote-failure envelope
 * so the client can reliably distinguish runtime errors from domain values.
 *
 * @since 2.0.0
 * @internal
 */
export const EFFECT_REMOTE_ERROR_MARKER = "__svelte_effect_remote__";

/**
 * Well-known symbol used to attach a payload decoder to a remote function
 * so the client's transport layer can decode domain error types.
 *
 * @since 2.0.0
 * @internal
 */
export const REMOTE_ERROR_DECODER = Symbol.for(
  "svelte-effect-runtime/remote-error-decoder",
);

/** Form validation helpers and types. */

/**
 * A single field-level or form-level validation issue reported by a
 * {@link Form} handler.
 *
 * @since 2.0.0
 */
export interface FormIssue {
  /** Human-readable validation message. */
  message: string;
  /** Path to the offending field as an array of string-or-number keys. */
  path: (string | number)[];
}

/**
 * Error subtype thrown by {@link Form} handlers to signal validation
 * failures. The `issues` array is forwarded to SvelteKit's `invalid()`
 * helper on the server and surfaced as `FormError` on the client.
 *
 * @since 2.0.0
 */
export interface FormError<SchemaType = unknown> {
  readonly _tag: "FormError";
  readonly issues: readonly FormIssue[];
  /** Phantom type slot for the schema this error was derived from. */
  readonly _schema?: SchemaType;
}

/**
 * Creates a {@link FormError} holding the given issues.
 *
 * @since 2.0.0
 * @param issues - The validation issues to attach.
 * @returns A FormError with the `_tag` set and no schema reference.
 */
export function create_form_error(issues: readonly FormIssue[]): FormError {
  return { _tag: "FormError", issues };
}

/**
 * Type guard that narrows an unknown value to a {@link FormError}.
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a FormError.
 */
export function is_form_error(value: unknown): value is FormError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)._tag === "FormError"
  );
}

/** Remote error types shared by client and server helpers. */

/**
 * Union of all wire-level error shapes that a remote function can
 * surface on its error channel.
 *
 * @example
 * ```ts
 * const result = yield* myQuery();
 * // error channel is RemoteFailure<DomainError>
 * ```
 *
 * @since 2.0.0
 */
export type RemoteFailure<ErrorType> =
  | ErrorType
  | RemoteValidationError
  | RemoteHttpError
  | RemoteTransportError;

/**
 * Validation errors that originate from a server-side {@link Form}
 * handler calling `invalid()` (SvelteKit's `fail`).
 *
 * @since 2.0.0
 */
export interface RemoteValidationError {
  readonly _tag: "RemoteValidationError";
  readonly issues?: readonly FormIssue[];
  readonly body?: unknown;
  readonly status: number;
}

/**
 * HTTP-level errors with a status code and optional response body. Raised
 * when the server explicitly calls SvelteKit's `error(status, body)`.
 *
 * @since 2.0.0
 */
export interface RemoteHttpError {
  readonly _tag: "RemoteHttpError";
  readonly status: number;
  readonly body?: unknown;
  readonly cause?: unknown;
}

/**
 * Transport-level errors raised by the client adapter when the network
 * request fails or the response cannot be decoded.
 *
 * @since 2.0.0
 */
export interface RemoteTransportError {
  readonly _tag: "RemoteTransportError";
  readonly cause?: unknown;
  readonly body?: unknown;
}

/**
 * Wire format for an encoded remote failure. The server wraps domain
 * errors in this envelope before serialising them with devalue.
 *
 * @since 2.0.0
 * @internal
 */
export interface SerializedRemoteFailureEnvelope {
  readonly __svelte_effect_remote__: true;
  readonly encoded: string;
}

/** Constructors for structured remote error values. */

/**
 * Creates a {@link RemoteValidationError} from a list of form issues.
 *
 * @since 2.0.0
 * @param issues - The validation issues reported by the server handler.
 * @param body - Optional response body returned alongside the error.
 * @param status - HTTP status code (defaults to 400).
 * @returns A remote-validation error shape.
 * @internal
 */
export function create_remote_validation_error(
  issues: readonly FormIssue[],
  body?: unknown,
  status = 400,
): RemoteValidationError {

  return { _tag: "RemoteValidationError", issues, body, status };
}

/**
 * Creates a {@link RemoteHttpError} for a given HTTP status.
 *
 * @since 2.0.0
 * @param status - The HTTP status code.
 * @param body - Optional response body.
 * @param cause - Optional underlying cause.
 * @returns A remote HTTP error shape.
 * @internal
 */
export function create_remote_http_error(
  status: number,
  body?: unknown,
  cause?: unknown,
): RemoteHttpError {

  return { _tag: "RemoteHttpError", status, body, cause };
}

/**
 * Creates a {@link RemoteTransportError} for network or decode failures.
 *
 * @since 2.0.0
 * @param cause - The underlying error that caused the transport failure.
 * @param body - Optional response body if one was received.
 * @returns A remote transport error shape.
 * @internal
 */
export function create_remote_transport_error(
  cause: unknown,
  body?: unknown,
): RemoteTransportError {

  return { _tag: "RemoteTransportError", cause, body };
}

/**
 * Wraps a devalue-encoded error string inside a
 * {@link SerializedRemoteFailureEnvelope}.
 *
 * @since 2.0.0
 * @param encoded - The devalue-encoded error value.
 * @returns The wire-format envelope.
 * @internal
 */
export function create_serialized_remote_failure_envelope(
  encoded: string,
): SerializedRemoteFailureEnvelope {

  return { __svelte_effect_remote__: true, encoded };
}

/** Type guards for structured remote error values. */

/**
 * Checks whether a value is a {@link SerializedRemoteFailureEnvelope}.
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a serialised failure envelope.
 * @internal
 */
export function is_serialized_remote_failure_envelope(
  value: unknown,
): value is SerializedRemoteFailureEnvelope {

  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).__svelte_effect_remote__ === true
  );
}

/**
 * Checks whether a value is a {@link RemoteValidationError}.
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a remote validation error.
 */
export function is_remote_validation_error(
  value: unknown,
): value is RemoteValidationError {

  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)._tag === "RemoteValidationError"
  );
}

/**
 * Checks whether a value is a {@link RemoteHttpError}.
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a remote HTTP error.
 */
export function is_remote_http_error(
  value: unknown,
): value is RemoteHttpError {

  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)._tag === "RemoteHttpError"
  );
}

/**
 * Checks whether a value is a {@link RemoteTransportError}.
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a remote transport error.
 */
export function is_remote_transport_error(
  value: unknown,
): value is RemoteTransportError {

  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)._tag === "RemoteTransportError"
  );
}
