import {
	InvalidRemoteFormResponseError,
	RemoteFormEndpointMissingError,
	UnsupportedRemoteFormResponseError,
} from "$/errors.ts";
import {
	create_remote_http_error,
	create_remote_transport_error,
	create_remote_validation_error,
} from "$/remote/shared.ts";
import { decode_remote_error, is_decoded_remote_failure } from "./failures.ts";
import { MakeEffectFromPromise, MakeEffectFromSync } from "./effect.ts";
import type { FormIssue, RemoteFailure } from "$/remote/shared.ts";
import type { StandardSchema } from "$/internal/schema.ts";
import { DecodeResponseFailure } from "./responses.ts";
import type { NativeFormRecord } from "./types.ts";
import { Effect, Option, Schema } from "effect";
import { to_form_data } from "./form-data.ts";
import { parse } from "devalue";

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

export function SubmitRemoteForm<Output, ErrorType = never>(
	form_obj: NativeFormRecord,
	input: unknown,
	decode_payload: (value: unknown) => unknown,
	remote_base: string,
	preflight_schema?: StandardSchema,
): Effect.Effect<Output, RemoteFailure<ErrorType>> {
	return Effect.gen(function* () {
		const action_id = yield* MakeEffectFromSync<string | undefined, ErrorType>(() =>
			get_remote_action_id(form_obj),
		);

		if (!action_id || remote_base.length === 0) {
			return yield* Effect.fail(
				create_remote_transport_error(new RemoteFormEndpointMissingError()),
			);
		}

		yield* ValidatePreflightInput<ErrorType>(preflight_schema, input);

		const response = yield* MakeEffectFromPromise<Response, ErrorType>((signal) =>
			fetch(to_remote_form_url(remote_base, action_id), {
				method: "POST",
				headers: get_remote_request_headers(),
				body: to_form_data(input),
				signal,
			}),
		);

		if (!response.ok) {
			const failure = yield* DecodeResponseFailure<ErrorType>(response);

			return yield* Effect.fail(failure);
		}

		const envelope = yield* MakeEffectFromPromise<unknown, ErrorType>(() => response.json());

		return yield* DecodeFormResponse<Output, ErrorType>(envelope, decode_payload);
	});
}

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

function ValidatePreflightInput<ErrorType>(
	schema: StandardSchema | undefined,
	input: unknown,
): Effect.Effect<void, RemoteFailure<ErrorType>> {
	return Effect.gen(function* () {
		if (!schema) {
			return;
		}

		const validated = yield* MakeEffectFromPromise<unknown, ErrorType>(() =>
			Promise.resolve(schema["~standard"].validate(input)),
		);

		if (!is_record(validated) || !Array.isArray(validated.issues)) {
			return;
		}

		const issues = validated.issues.map(normalize_standard_issue);

		return yield* Effect.fail(create_remote_validation_error(issues, { issues }, 400));
	});
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

function DecodeFormResponse<Output, ErrorType>(
	envelope: unknown,
	decode_payload: (value: unknown) => unknown,
): Effect.Effect<Output, RemoteFailure<ErrorType>> {
	return Effect.gen(function* () {
		const response = decode_remote_form_response_envelope(envelope);

		if (!response) {
			return yield* Effect.fail(
				create_remote_transport_error(
					new InvalidRemoteFormResponseError(envelope),
					envelope,
				),
			);
		}

		if (response._tag === "RemoteFormErrorEnvelope") {
			const decoded = decode_remote_error<ErrorType>(response.error);

			if (is_decoded_remote_failure(decoded)) {
				return yield* Effect.fail(decoded);
			}

			return yield* Effect.fail(
				create_remote_http_error(response.status ?? 500, response.error),
			);
		}

		const result_text = response.result ?? response.data;

		if (result_text === undefined) {
			return yield* Effect.fail(
				create_remote_transport_error(
					new UnsupportedRemoteFormResponseError(envelope),
					envelope,
				),
			);
		}

		const parsed = yield* MakeEffectFromSync<unknown, ErrorType>(() => parse(result_text));
		const payload = yield* MakeEffectFromSync<unknown, ErrorType>(() => decode_payload(parsed));
		const decoded = decode_remote_form_payload<Output>(payload);

		if (!decoded) {
			return yield* Effect.fail(
				create_remote_transport_error(
					new UnsupportedRemoteFormResponseError(envelope),
					envelope,
				),
			);
		}

		if (decoded.issues && decoded.issues.length > 0) {
			return yield* Effect.fail(create_remote_validation_error(decoded.issues, decoded, 400));
		}

		return decoded.result as Output;
	});
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
