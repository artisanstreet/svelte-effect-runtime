import type { OpaqueRemoteFailureReason } from "$/remote/diagnostics.ts";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import * as SvelteKit from "@sveltejs/kit";
import { is_form_error, type FormIssue } from "$/remote/shared.ts";
import { Cause, Schema } from "effect";
import { stringify } from "devalue";

/**
 * Records that a failure lost its detail on the way to the client, so callers
 * can report the original error instead of dropping it silently.
 *
 * @example
 * ```ts
 * const diagnostic: OpaqueRemoteFailure = { reason: "untagged", value: err };
 * ```
 *
 * @since 4.2.0
 */
export type OpaqueRemoteFailure = {
	readonly reason: OpaqueRemoteFailureReason;
	readonly value: unknown;
};

type EncodedRemoteFailure = {
	readonly encoded: string;
	readonly opaque?: OpaqueRemoteFailure;
};

export type RemoteCauseResolution =
	| {
			readonly _tag: "SvelteKitControlFlow";
			readonly value: unknown;
	  }
	| {
			readonly _tag: "InterruptOnly";
			readonly cause: Cause.Cause<unknown>;
	  }
	| {
			readonly _tag: "FormInvalid";
			readonly issues: readonly FormIssue[];
	  }
	| {
			readonly _tag: "RemoteFailure";
			readonly encoded: string;
			readonly opaque?: OpaqueRemoteFailure;
	  };

/** Preserves SvelteKit control flow before classifying transportable Effect failures. */
export function classify_remote_cause(cause: Cause.Cause<unknown>): RemoteCauseResolution {
	const control_flow = find_sveltekit_control_flow(cause);

	if (control_flow !== undefined) {
		return {
			_tag: "SvelteKitControlFlow",
			value: control_flow,
		};
	}

	if (Cause.hasInterruptsOnly(cause)) {
		return {
			_tag: "InterruptOnly",
			cause,
		};
	}

	const form_error_issues = find_form_error_issues(cause);

	if (form_error_issues !== undefined) {
		return {
			_tag: "FormInvalid",
			issues: form_error_issues,
		};
	}

	const failure = encode_remote_failure_detailed(cause);

	return {
		_tag: "RemoteFailure",
		encoded: failure.encoded,
		...(failure.opaque ? { opaque: failure.opaque } : {}),
	};
}

/** Encodes a remote failure into the transport ABI shared with generated clients. */
export function encode_remote_failure(cause: Cause.Cause<unknown>): string {
	return encode_remote_failure_detailed(cause).encoded;
}

/**
 * Encodes a remote failure and reports whether its detail survived encoding.
 *
 * @example
 * ```ts
 * const { encoded, opaque } = encode_remote_failure_detailed(cause);
 * ```
 *
 * @since 4.2.0
 * @param cause - Cause carrying the handler's failure.
 * @returns The encoded payload and, when detail was lost, why.
 */
export function encode_remote_failure_detailed(cause: Cause.Cause<unknown>): EncodedRemoteFailure {
	for (const reason of cause.reasons) {
		if (!Cause.isFailReason(reason)) {
			continue;
		}

		const tagged = has_public_remote_failure_tag(reason.error);

		if (!tagged) {
			return {
				encoded: stringify_unknown_remote_failure(),
				opaque: { reason: "untagged", value: reason.error },
			};
		}

		const failure = to_serializable_public_failure(reason.error);
		const encoded = failure === undefined ? undefined : stringify_failure(failure);

		if (encoded !== undefined) {
			return { encoded };
		}

		return {
			encoded: stringify_unknown_remote_failure(),
			opaque: { reason: "unserializable", value: reason.error },
		};
	}

	return {
		encoded: stringify_unknown_remote_failure(),
		opaque: { reason: "unknown", value: find_defect(cause) },
	};
}

/** Surfaces a defect so an unencodable cause still names something concrete. */
function find_defect(cause: Cause.Cause<unknown>): unknown {
	for (const reason of cause.reasons) {
		if (Cause.isDieReason(reason)) {
			return reason.defect;
		}
	}

	return undefined;
}

function find_sveltekit_control_flow(cause: Cause.Cause<unknown>): unknown | undefined {
	for (const reason of cause.reasons) {
		if (!Cause.isDieReason(reason)) {
			continue;
		}

		if (is_sveltekit_control_flow(reason.defect)) {
			return reason.defect;
		}
	}

	return undefined;
}

function find_form_error_issues(cause: Cause.Cause<unknown>): readonly FormIssue[] | undefined {
	for (const reason of cause.reasons) {
		if (!Cause.isFailReason(reason)) {
			continue;
		}

		const issues = get_form_error_issues(reason.error);

		if (issues !== undefined) {
			return issues;
		}
	}

	return undefined;
}

function get_form_error_issues(value: unknown): readonly FormIssue[] | undefined {
	if (is_form_error(value)) {
		return value.issues;
	}

	return is_tagged_form_error(value) ? [] : undefined;
}

function is_sveltekit_control_flow(value: unknown): boolean {
	return isRedirect(value) || isHttpError(value) || is_validation_error(value);
}

/**
 * SvelteKit `3.0.0-next.21` and `3.0.0-next.22` removed `isValidationError`
 * from the `@sveltejs/kit` index (`3.0.0-next.23` restored it), so a named
 * import would crash module evaluation on those versions. The namespace access
 * stays safe on every version and the structural check mirrors SvelteKit's
 * `ValidationError` (`Error` named `ValidationError` carrying `issues`).
 */
function is_validation_error(value: unknown): boolean {
	const native = (SvelteKit as { isValidationError?: (value: unknown) => boolean })
		.isValidationError;

	if (native !== undefined) {
		return native(value);
	}

	return (
		value instanceof globalThis.Error &&
		value.name === "ValidationError" &&
		Array.isArray((value as { issues?: unknown }).issues)
	);
}

function stringify_failure(value: unknown): string | undefined {
	try {
		return stringify(value);
	} catch {
		return undefined;
	}
}

function to_serializable_public_failure(value: unknown, seen = new WeakSet<object>()): unknown {
	if (typeof value === "function" || typeof value === "symbol") {
		return undefined;
	}

	if (!is_object_like(value)) {
		return value;
	}

	if (stringify_failure(value) !== undefined) {
		return value;
	}

	if (is_internal_object(value)) {
		return undefined;
	}

	if (seen.has(value)) {
		return undefined;
	}

	seen.add(value);

	const serializable = Array.isArray(value)
		? value.map((item) => to_serializable_public_failure(item, seen))
		: to_plain_record(value, seen);

	seen.delete(value);

	return serializable;
}

function to_plain_record(value: object, seen: WeakSet<object>): Record<string, unknown> {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const record: Record<string, unknown> = {};

	for (const [key, descriptor] of Object.entries(descriptors)) {
		if (key === "stack" || !("value" in descriptor)) {
			continue;
		}

		record[key] = to_serializable_public_failure(descriptor.value, seen);
	}

	if (value instanceof Error && !("message" in record)) {
		record.message = value.message;
	}

	return record;
}

function is_object_like(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

function has_public_remote_failure_tag(value: unknown): boolean {
	return is_object_like(value) && typeof (value as { _tag?: unknown })._tag === "string";
}

function is_internal_object(value: object): boolean {
	return (
		!Array.isArray(value) && !is_plain_record(value) && !has_public_remote_failure_tag(value)
	);
}

function is_plain_record(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);

	return prototype === Object.prototype || prototype === null;
}

function create_unknown_remote_failure(): { readonly message: string } {
	return { message: "[UNKNOWN_REMOTE_FAILURE]: Unknown error" };
}

function stringify_unknown_remote_failure(): string {
	return stringify(create_unknown_remote_failure());
}

const is_tagged_form_error = Schema.is(
	Schema.Struct({
		_tag: Schema.Literal("FormError"),
	}),
);
