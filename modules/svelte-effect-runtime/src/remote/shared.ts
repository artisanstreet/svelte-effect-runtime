import { Schema } from "effect";

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
 * @example
 * ```ts
 * if (envelope[effect_remote_error_marker] === true) {
 *   console.log(envelope.encoded);
 * }
 * ```
 *
 * @since 2.0.0
 * @internal
 */
export const effect_remote_error_marker = "__svelte_effect_remote__";

/**
 * Well-known symbol used to attach a payload decoder to a remote function
 * so the client's transport layer can decode domain error types.
 *
 * @example
 * ```ts
 * Reflect.get(remote_function, remote_error_decoder);
 * ```
 *
 * @since 2.0.0
 * @internal
 */
export const remote_error_decoder = Symbol.for("svelte-effect-runtime/remote-error-decoder");

/**
 * A single field-level or form-level validation issue reported by a
 * {@link Form} handler.
 *
 * @example
 * ```ts
 * const issue: FormIssue = {
 *   message: "Use an email address.",
 *   path: ["email"],
 * };
 * ```
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
 * @example
 * ```ts
 * const error: FormError = {
 *   _tag: "FormError",
 *   issues: [{ message: "Required.", path: ["email"] }],
 * };
 * ```
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
 * @example
 * ```ts
 * const error = create_form_error([
 *   { message: "Required.", path: ["email"] },
 * ]);
 * ```
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
 * @example
 * ```ts
 * if (is_form_error(error)) {
 *   console.log(error.issues);
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a FormError.
 */
export function is_form_error(value: unknown): value is FormError {
	return is_form_error_value(value);
}

/**
 * Union of all wire-level error shapes that a remote function can
 * surface on its error channel.
 *
 * @example
 * ```ts
 * const result: Effect.Effect<User, RemoteFailure<DomainError>> = myQuery();
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
 * @example
 * ```ts
 * const error: RemoteValidationError = {
 *   _tag: "RemoteValidationError",
 *   status: 400,
 *   issues: [{ message: "Required.", path: ["email"] }],
 * };
 * ```
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
 * @example
 * ```ts
 * const error: RemoteHttpError = {
 *   _tag: "RemoteHttpError",
 *   status: 404,
 *   body: { message: "Not found" },
 * };
 * ```
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
 * @example
 * ```ts
 * const error: RemoteTransportError = {
 *   _tag: "RemoteTransportError",
 *   cause: new Error("Network unavailable"),
 * };
 * ```
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
 * @example
 * ```ts
 * const envelope: SerializedRemoteFailureEnvelope = {
 *   __svelte_effect_remote__: true,
 *   encoded: "[\"DomainError\"]",
 * };
 * ```
 *
 * @since 2.0.0
 * @internal
 */
export interface SerializedRemoteFailureEnvelope {
	readonly __svelte_effect_remote__: true;
	readonly encoded: string;
}

const FormIssuePathSegmentSchema = Schema.Union([Schema.String, Schema.Number]);

const FormIssueSchema = Schema.Struct({
	message: Schema.String,
	path: Schema.Array(FormIssuePathSegmentSchema),
});

const FormErrorSchema = Schema.Struct({
	_tag: Schema.Literal("FormError"),
	issues: Schema.Array(FormIssueSchema),
});

const SerializedRemoteFailureEnvelopeSchema = Schema.Struct({
	__svelte_effect_remote__: Schema.Literal(true),
	encoded: Schema.String,
});

const RemoteValidationErrorSchema = Schema.Struct({
	_tag: Schema.Literal("RemoteValidationError"),
	body: Schema.optional(Schema.Unknown),
	issues: Schema.optional(Schema.Array(FormIssueSchema)),
	status: Schema.Number,
});

const RemoteHttpErrorSchema = Schema.Struct({
	_tag: Schema.Literal("RemoteHttpError"),
	body: Schema.optional(Schema.Unknown),
	cause: Schema.optional(Schema.Unknown),
	status: Schema.Number,
});

const RemoteTransportErrorSchema = Schema.Struct({
	_tag: Schema.Literal("RemoteTransportError"),
	body: Schema.optional(Schema.Unknown),
	cause: Schema.optional(Schema.Unknown),
});

const is_form_error_value = Schema.is(FormErrorSchema);
const is_remote_http_error_value = Schema.is(RemoteHttpErrorSchema);
const is_remote_transport_error_value = Schema.is(RemoteTransportErrorSchema);
const is_remote_validation_error_value = Schema.is(RemoteValidationErrorSchema);
const is_serialized_remote_failure_envelope_value = Schema.is(
	SerializedRemoteFailureEnvelopeSchema,
);

/**
 * Creates a {@link RemoteValidationError} from a list of form issues.
 *
 * @example
 * ```ts
 * const error = create_remote_validation_error([
 *   { message: "Required.", path: ["email"] },
 * ]);
 * ```
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
 * @example
 * ```ts
 * const error = create_remote_http_error(404, { message: "Not found" });
 * ```
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
 * @example
 * ```ts
 * const error = create_remote_transport_error(new Error("Network unavailable"));
 * ```
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
 * @example
 * ```ts
 * const envelope = create_serialized_remote_failure_envelope(encoded);
 * ```
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

/**
 * Checks whether a value is a {@link SerializedRemoteFailureEnvelope}.
 *
 * @example
 * ```ts
 * if (is_serialized_remote_failure_envelope(value)) {
 *   console.log(value.encoded);
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a serialised failure envelope.
 * @internal
 */
export function is_serialized_remote_failure_envelope(
	value: unknown,
): value is SerializedRemoteFailureEnvelope {
	return is_serialized_remote_failure_envelope_value(value);
}

/**
 * Checks whether a value is a {@link RemoteValidationError}.
 *
 * @example
 * ```ts
 * if (is_remote_validation_error(error)) {
 *   console.log(error.issues);
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a remote validation error.
 */
export function is_remote_validation_error(value: unknown): value is RemoteValidationError {
	return is_remote_validation_error_value(value);
}

/**
 * Checks whether a value is a {@link RemoteHttpError}.
 *
 * @example
 * ```ts
 * if (is_remote_http_error(error)) {
 *   console.log(error.status);
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a remote HTTP error.
 */
export function is_remote_http_error(value: unknown): value is RemoteHttpError {
	return is_remote_http_error_value(value);
}

/**
 * Checks whether a value is a {@link RemoteTransportError}.
 *
 * @example
 * ```ts
 * if (is_remote_transport_error(error)) {
 *   console.error(error.cause);
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - The value to check.
 * @returns `true` when the value is a remote transport error.
 */
export function is_remote_transport_error(value: unknown): value is RemoteTransportError {
	return is_remote_transport_error_value(value);
}
