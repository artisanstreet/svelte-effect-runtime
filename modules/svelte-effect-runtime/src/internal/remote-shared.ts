/**
 * Marker property name placed on serialized `RemoteFailure` envelopes so the
 * client adapters can recognise server-produced failure payloads.
 *
 * @internal Internal - do not use.
 */
export const EFFECT_REMOTE_ERROR_MARKER = "__svelte_effect_remote__";
/**
 * Well-known symbol used to attach a payload decoder to a remote function,
 * enabling the client to reconstruct typed domain errors from wire data.
 *
 * @internal Internal - do not use.
 */
export const REMOTE_ERROR_DECODER = Symbol.for(
  "svelte-effect-runtime/remote-error-decoder",
);

/**
 * A single validation problem surfaced by a remote form or schema check.
 * Mirrors SvelteKit's `invalid()` issue shape.
 */
export interface FormIssue {
  /** Human-readable description of the failure at {@link FormIssue.path}. */
  readonly message: string;
  /** Field path (dot or array-index segments) the issue applies to. */
  readonly path: ReadonlyArray<string | number>;
}

/**
 * Typed error produced by `invalid.form(...)` / `invalid.<field>(...)` helpers
 * inside a `Form` handler. Carries the collected `FormIssue`s to surface to
 * the browser.
 */
export interface FormError<SchemaType = unknown> {
  /** Discriminator identifying this as a form error. */
  readonly _tag: "FormError";
  /** Issues produced by the handler, one per failed field. */
  readonly issues: ReadonlyArray<FormIssue>;
  /**
   * Phantom reference to the originating schema. Used purely for type
   * inference of field helpers.
   */
  readonly _schema?: SchemaType | undefined;
}

/**
 * Legacy wrapper around a typed server-side domain error value.
 *
 * @deprecated Tagged remote domain errors are no longer wrapped in
 * `RemoteDomainError`. The user's own tagged error is now placed directly on
 * the Effect error channel so `Effect.catchTag("YourTag", ...)` works without
 * unwrapping. This interface is kept only for backwards compatibility with
 * code that pattern-matched on `_tag === "RemoteDomainError"`.
 */
export interface RemoteDomainError<ErrorType = unknown> {
  /** Discriminator identifying this variant of `RemoteFailure`. */
  readonly _tag: "RemoteDomainError";
  /** The original typed error value produced on the server. */
  readonly cause: ErrorType;
  /** HTTP status code associated with the failure. */
  readonly status: number;
}

/**
 * Remote failure emitted when request validation (schema or form) rejects the
 * payload. Defaults to HTTP `400`, but callers may override the status code
 * when constructing the value.
 */
export interface RemoteValidationError {
  /** Discriminator identifying this variant of `RemoteFailure`. */
  readonly _tag: "RemoteValidationError";
  /** Raw response body returned alongside the failure, when available. */
  readonly body?: unknown;
  /** Validation issues, keyed by field path. */
  readonly issues: ReadonlyArray<FormIssue>;
  /** HTTP status code for the validation failure, defaulting to `400`. */
  readonly status: number;
}

/**
 * Remote failure for HTTP-level errors returned by the server that do not map
 * onto a typed domain error or validation failure.
 */
export interface RemoteHttpError {
  /** Discriminator identifying this variant of `RemoteFailure`. */
  readonly _tag: "RemoteHttpError";
  /** Parsed response body, if any. */
  readonly body?: unknown;
  /** Original thrown value captured while handling the response. */
  readonly cause: unknown;
  /** HTTP status code reported by the response. */
  readonly status: number;
}

/**
 * Remote failure for transport-level breakages (network errors, decoding
 * failures). Does not carry an HTTP status.
 */
export interface RemoteTransportError {
  /** Discriminator identifying this variant of `RemoteFailure`. */
  readonly _tag: "RemoteTransportError";
  /** Raw body captured when the transport failure was detected, if any. */
  readonly body?: unknown;
  /** Underlying error value - usually a `TypeError` or `DOMException`. */
  readonly cause: unknown;
}

/**
 * Error channel produced by every remote Effect wrapper. A server-side
 * `Effect.fail(MyTaggedError)` surfaces on the client as the raw `ErrorType`,
 * so `Effect.catchTag("MyTag", ...)` narrows directly to your error. The
 * framework-level failure variants (`RemoteValidationError`,
 * `RemoteHttpError`, `RemoteTransportError`) are still included for transport
 * and HTTP failures that the caller didn't model explicitly.
 */
export type RemoteFailure<ErrorType = unknown> =
  | ErrorType
  | RemoteValidationError
  | RemoteHttpError
  | RemoteTransportError;

/**
 * Wire shape of a serialised remote failure envelope that the server embeds
 * in its response body.
 *
 * @internal Internal - do not use.
 */
export interface SerializedRemoteFailureEnvelope {
  /** Marker flag; always `true`. */
  readonly [EFFECT_REMOTE_ERROR_MARKER]: true;
  /** `devalue.stringify`-encoded payload for the failure value. */
  readonly encoded: string;
}

/**
 * Construct a {@link FormError} from one or more {@link FormIssue}s.
 *
 * @internal Internal - do not use.
 */
export function create_form_error<SchemaType = unknown>(
  ...issues: Array<FormIssue>
): FormError<SchemaType> {
  return {
    _tag: "FormError",
    issues,
  };
}

/**
 * Build a {@link RemoteDomainError} around a typed server-side error value.
 *
 * @deprecated Remote tagged failures are no longer wrapped - the user's
 * tagged error is forwarded directly on the Effect error channel. This helper
 * is retained for backwards compatibility with downstream code that still
 * constructs `RemoteDomainError` values explicitly.
 *
 * @internal Internal - do not use.
 */
export function create_remote_domain_error<ErrorType = unknown>(
  cause: ErrorType,
  status: number,
): RemoteDomainError<ErrorType> {
  return {
    _tag: "RemoteDomainError",
    cause,
    status,
  };
}

/**
 * Build a {@link RemoteValidationError} from a list of issues.
 *
 * @internal Internal - do not use.
 */
export function create_remote_validation_error(
  issues: ReadonlyArray<FormIssue>,
  options: {
    body?: unknown;
    status?: number;
  } = {},
): RemoteValidationError {
  return {
    _tag: "RemoteValidationError",
    body: options.body,
    issues,
    status: options.status ?? 400,
  };
}

/**
 * Build a {@link RemoteHttpError} from an arbitrary thrown value.
 *
 * @internal Internal - do not use.
 */
export function create_remote_http_error(
  cause: unknown,
  options: {
    body?: unknown;
    status?: number;
  } = {},
): RemoteHttpError {
  return {
    _tag: "RemoteHttpError",
    body: options.body,
    cause,
    status: options.status ?? 500,
  };
}

/**
 * Build a {@link RemoteTransportError} from an arbitrary thrown value.
 *
 * @internal Internal - do not use.
 */
export function create_remote_transport_error(
  cause: unknown,
  body?: unknown,
): RemoteTransportError {
  return {
    _tag: "RemoteTransportError",
    body,
    cause,
  };
}

/**
 * Wrap a pre-encoded failure payload in the marker envelope the client
 * adapters look for when decoding responses.
 *
 * @internal Internal - do not use.
 */
export function create_serialized_remote_failure_envelope(
  encoded: string,
): SerializedRemoteFailureEnvelope {
  return {
    [EFFECT_REMOTE_ERROR_MARKER]: true,
    encoded,
  };
}

/**
 * Type guard for {@link FormError} values.
 *
 * @internal Internal - do not use.
 */
export function is_form_error(value: unknown): value is FormError {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { _tag?: unknown })._tag === "FormError" &&
      Array.isArray((value as { issues?: unknown }).issues),
  );
}

/**
 * Type guard recognising the marker envelope wrapping an encoded remote
 * failure payload.
 *
 * @internal Internal - do not use.
 */
export function is_serialized_remote_failure_envelope(
  value: unknown,
): value is SerializedRemoteFailureEnvelope {
  return Boolean(
    value &&
      typeof value === "object" &&
      EFFECT_REMOTE_ERROR_MARKER in value &&
      (value as Record<string, unknown>)[EFFECT_REMOTE_ERROR_MARKER] === true &&
      typeof (value as { encoded?: unknown }).encoded === "string",
  );
}

/**
 * Type guard for individual {@link FormIssue} values.
 *
 * @internal Internal - do not use.
 */
export function is_remote_validation_issue(
  value: unknown,
): value is FormIssue {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { message?: unknown }).message === "string" &&
      Array.isArray((value as { path?: unknown }).path),
  );
}
