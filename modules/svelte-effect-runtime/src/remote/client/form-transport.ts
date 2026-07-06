import {
	create_remote_http_error,
	create_remote_transport_error,
	create_remote_validation_error,
} from "$/remote/shared.ts";
import {
	InvalidRemoteFormResponseError,
	RemoteFormEndpointMissingError,
	UnsupportedRemoteFormResponseError,
} from "$/errors.ts";
import type { StandardSchema } from "$/internal/schema.ts";
import type { FormIssue } from "$/remote/shared.ts";
import { Option, Schema } from "effect";
import { parse } from "devalue";

import { decode_remote_error, is_decoded_remote_failure } from "./failures.ts";
import { decode_response_failure } from "./responses.ts";
import { to_form_data } from "./form-data.ts";
import type { NativeFormRecord } from "./types.ts";

type RemoteFormResponseEnvelope =
	| {
			readonly _tag: "RemoteFormErrorEnvelope";
			readonly error?: unknown;
			readonly status?: number | undefined;
	  }
	| {
			readonly _tag: "RemoteFormResultEnvelope";
			readonly data?: string | undefined;
			readonly result?: string | undefined;
	  };

type RemoteFormDecodedPayload<Output> = {
	readonly issues?: readonly FormIssue[];
	readonly result?: Output;
};

const FormIssuePathSegmentSchema = Schema.Union([Schema.String, Schema.Number]);

const FormIssueSchema = Schema.Struct({
	message: Schema.String,
	path: Schema.Array(FormIssuePathSegmentSchema),
});

const RemoteFormErrorEnvelopeSchema = Schema.Struct({
	type: Schema.Literal("error"),
	error: Schema.optional(Schema.Unknown),
	status: Schema.optional(Schema.Number),
});

const RemoteFormResultEnvelopeSchema = Schema.Struct({
	type: Schema.Literal("result"),
	data: Schema.optional(Schema.String),
	result: Schema.optional(Schema.String),
});

const RemoteFormResponseEnvelopeSchema = Schema.Union([
	RemoteFormErrorEnvelopeSchema,
	RemoteFormResultEnvelopeSchema,
]);

const RemoteFormDecodedPayloadSchema = Schema.Struct({
	issues: Schema.optional(Schema.Array(FormIssueSchema)),
	result: Schema.optional(Schema.Unknown),
});

const DecodeRemoteFormResponseEnvelope = Schema.decodeUnknownOption(
	RemoteFormResponseEnvelopeSchema,
);
const DecodeRemoteFormPayload = Schema.decodeUnknownOption(RemoteFormDecodedPayloadSchema);

/**
 * Submits a native remote form through the SvelteKit remote endpoint.
 *
 * @since 2.0.0
 * @param form_obj - Native form object being adapted.
 * @param input - Form input value.
 * @param decode_payload - Function to decode successful payloads.
 * @param remote_base - Base URL for the remote endpoint.
 * @param preflight_schema - Optional schema used to mirror SvelteKit's
 *   client-side preflight before posting direct programmatic input.
 * @returns Decoded form output.
 */
export async function submit_remote_form<Output>(
	form_obj: NativeFormRecord,
	input: unknown,
	decode_payload: (value: unknown) => unknown,
	remote_base: string,
	preflight_schema?: StandardSchema,
): Promise<Output> {
	const action_id = get_remote_action_id(form_obj);

	if (!action_id || remote_base.length === 0) {
		throw create_remote_transport_error(new RemoteFormEndpointMissingError());
	}

	await validate_preflight_input(preflight_schema, input);

	const response = await fetch(to_remote_form_url(remote_base, action_id), {
		method: "POST",
		headers: get_remote_request_headers(),
		body: to_form_data(input),
	});

	if (!response.ok) {
		throw await decode_response_failure(response);
	}

	const envelope = await response.json();

	return decode_form_response<Output>(envelope, decode_payload);
}

/**
 * Extracts SvelteKit's remote action id from a native form action URL.
 *
 * @since 2.0.0
 * @param form_obj - Native form object being adapted.
 * @returns Remote action id when present.
 */
export function get_remote_action_id(form_obj: NativeFormRecord): string | undefined {
	const action = form_obj.action;

	if (typeof action !== "string") {
		return undefined;
	}

	const fallback = "http://localhost/";
	const href = typeof location === "undefined" ? fallback : location.href;
	const url = new URL(action, href);

	return url.searchParams.get("/remote") ?? url.searchParams.get("remote") ?? undefined;
}

function to_remote_form_url(remote_base: string, action_id: string): string {
	const parts = action_id.split("/");
	const head = parts.slice(0, 2).join("/");
	const tail = parts.slice(2).join("/");
	const normalized_base = remote_base.replace(/\/$/, "");

	if (tail.length === 0) {
		return `${normalized_base}/${head}`;
	}

	return `${normalized_base}/${head}/${encodeURIComponent(tail)}`;
}

function get_remote_request_headers(): HeadersInit {
	if (typeof location === "undefined") {
		return {};
	}

	return {
		"x-sveltekit-pathname": location.pathname,
		"x-sveltekit-search": location.search,
	};
}

async function validate_preflight_input(
	schema: StandardSchema | undefined,
	input: unknown,
): Promise<void> {
	if (!schema) {
		return;
	}

	const validated = await schema["~standard"].validate(input);

	if (!is_record(validated) || !Array.isArray(validated.issues)) {
		return;
	}

	const issues = validated.issues.map(normalize_standard_issue);

	throw create_remote_validation_error(issues, { issues }, 400);
}

function normalize_standard_issue(issue: unknown): FormIssue {
	if (!is_record(issue)) {
		return { message: String(issue), path: [] };
	}

	const message = typeof issue.message === "string" ? issue.message : "Invalid input";
	const path = Array.isArray(issue.path) ? issue.path.flatMap(normalize_path_segment) : [];

	return { message, path };
}

function normalize_path_segment(segment: unknown): Array<string | number> {
	if (typeof segment === "string" || typeof segment === "number") {
		return [segment];
	}

	if (!is_record(segment)) {
		return [];
	}

	const key = segment.key;

	if (typeof key === "string" || typeof key === "number") {
		return [key];
	}

	return [];
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function decode_form_response<Output>(
	envelope: unknown,
	decode_payload: (value: unknown) => unknown,
): Output {
	const response = decode_remote_form_response_envelope(envelope);

	if (!response) {
		throw create_remote_transport_error(new InvalidRemoteFormResponseError(envelope), envelope);
	}

	if (response._tag === "RemoteFormErrorEnvelope") {
		const decoded = decode_remote_error(response.error);

		if (is_decoded_remote_failure(decoded)) {
			throw decoded;
		}

		throw create_remote_http_error(response.status ?? 500, response.error);
	}

	const result_text = response.result ?? response.data;

	if (result_text === undefined) {
		throw create_remote_transport_error(
			new UnsupportedRemoteFormResponseError(envelope),
			envelope,
		);
	}

	const parsed = parse(result_text);
	const decoded = decode_remote_form_payload<Output>(decode_payload(parsed));

	if (!decoded) {
		throw create_remote_transport_error(
			new UnsupportedRemoteFormResponseError(envelope),
			envelope,
		);
	}

	if (decoded.issues && decoded.issues.length > 0) {
		throw create_remote_validation_error(decoded.issues, decoded, 400);
	}

	return decoded.result as Output;
}

function decode_remote_form_response_envelope(
	envelope: unknown,
): RemoteFormResponseEnvelope | undefined {
	const decoded = DecodeRemoteFormResponseEnvelope(envelope);

	if (!Option.isSome(decoded)) {
		return undefined;
	}

	if (decoded.value.type === "error") {
		return {
			_tag: "RemoteFormErrorEnvelope",
			error: decoded.value.error,
			status: decoded.value.status,
		};
	}

	return {
		_tag: "RemoteFormResultEnvelope",
		data: decoded.value.data,
		result: decoded.value.result,
	};
}

function decode_remote_form_payload<Output>(
	payload: unknown,
): RemoteFormDecodedPayload<Output> | undefined {
	const decoded = DecodeRemoteFormPayload(payload);

	if (!Option.isSome(decoded)) {
		return undefined;
	}

	return decoded.value as RemoteFormDecodedPayload<Output>;
}
