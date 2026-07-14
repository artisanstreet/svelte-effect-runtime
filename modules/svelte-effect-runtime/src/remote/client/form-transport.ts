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
import { decode_remote_error, is_decoded_remote_failure } from "$/remote/failures.ts";
import { MakeEffectFromPromise, MakeEffectFromSync } from "$/remote/effect.ts";
import type { FormIssue } from "$/remote/shared.ts";
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
			readonly data: string;
	  }
	| {
			readonly _tag: "RemoteFormRedirectEnvelope";
			readonly location: string;
	  };

export interface RemoteFormTransport {
	readonly binary_form_content_type?: string;
	readonly decoders?: Record<string, (value: unknown) => unknown>;
	readonly navigate?: (location: string, invalidate_all: boolean) => PromiseLike<void> | void;
	readonly remote_request?: (url: string, init?: RequestInit) => PromiseLike<unknown>;
	readonly refresh?: () => PromiseLike<void> | void;
	readonly serialize_binary_form?: (
		data: unknown,
		meta: { readonly remote_refreshes: readonly string[] },
	) => { readonly blob: Blob };
}

interface KitRemoteFormTransport extends RemoteFormTransport {
	readonly binary_form_content_type: string;
	readonly remote_request: (url: string, init?: RequestInit) => PromiseLike<unknown>;
	readonly serialize_binary_form: (
		data: unknown,
		meta: { readonly remote_refreshes: readonly string[] },
	) => { readonly blob: Blob };
}

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
	data: Schema.String,
});

const RemoteFormRedirectEnvelopeSchema = Schema.Struct({
	type: Schema.Literal("redirect"),
	location: Schema.String,
});

const RemoteFormResponseEnvelopeSchema = Schema.Union([
	RemoteFormErrorEnvelopeSchema,
	RemoteFormResultEnvelopeSchema,
	RemoteFormRedirectEnvelopeSchema,
]);

const RemoteFormDecodedPayloadSchema = Schema.Struct({
	issues: Schema.optional(Schema.Array(FormIssueSchema)),
	result: Schema.optional(Schema.Unknown),
});

const RemoteFormRedirectDataSchema = Schema.Struct({
	redirect: Schema.String,
});

const RemoteFormResultDataSchema = Schema.Struct({
	_: Schema.Unknown,
});

const KitRemoteFormDataSchema = Schema.Struct({
	_: Schema.optional(Schema.Unknown),
	redirect: Schema.optional(Schema.String),
	r: Schema.optional(Schema.Literal(true)),
});

const DecodeRemoteFormResponseEnvelope = Schema.decodeUnknownOption(
	RemoteFormResponseEnvelopeSchema,
);
const DecodeRemoteFormPayload = Schema.decodeUnknownOption(RemoteFormDecodedPayloadSchema);
const DecodeRemoteFormRedirectData = Schema.decodeUnknownOption(RemoteFormRedirectDataSchema);
const DecodeRemoteFormResultData = Schema.decodeUnknownOption(RemoteFormResultDataSchema);
const DecodeKitRemoteFormData = Schema.decodeUnknownOption(KitRemoteFormDataSchema);

export const SubmitRemoteForm = <Output, ErrorType = never>(
	form_obj: NativeFormRecord,
	input: unknown,
	decode_payload: (value: unknown) => unknown,
	remote_base: string,
	remote_transport: RemoteFormTransport,
	preflight_schema?: StandardSchema,
) =>
	Effect.gen(function* () {
		const action_id = yield* MakeEffectFromSync<string | undefined, ErrorType>(() =>
			get_remote_action_id(form_obj),
		);

		if (!action_id || remote_base.length === 0) {
			return yield* Effect.fail(
				create_remote_transport_error(new RemoteFormEndpointMissingError()),
			);
		}

		yield* ValidatePreflightInput<ErrorType>(preflight_schema, input);

		if (is_kit_remote_form_transport(remote_transport)) {
			return yield* SubmitRemoteFormWithKit<Output, ErrorType>(
				action_id,
				input,
				decode_payload,
				remote_base,
				remote_transport,
			);
		}

		const response = yield* MakeEffectFromPromise<Response, ErrorType>((signal) =>
			fetch(to_remote_form_url(remote_base, action_id), {
				method: "POST",
				headers: get_remote_request_headers(),
				body: to_form_data(to_remote_form_input(input, action_id)),
				signal,
			}),
		);

		if (!response.ok) {
			const failure = yield* DecodeResponseFailure<ErrorType>(response);

			return yield* Effect.fail(failure);
		}

		const envelope = yield* MakeEffectFromPromise<unknown, ErrorType>(() => response.json());

		return yield* DecodeFormResponse<Output, ErrorType>(
			envelope,
			decode_payload,
			remote_transport,
		);
	});

const SubmitRemoteFormWithKit = <Output, ErrorType>(
	action_id: string,
	input: unknown,
	decode_payload: (value: unknown) => unknown,
	remote_base: string,
	remote_transport: KitRemoteFormTransport,
) =>
	Effect.gen(function* () {
		const url = to_remote_form_url(remote_base, action_id);
		const body = yield* MakeEffectFromSync<Blob, ErrorType>(
			() =>
				remote_transport.serialize_binary_form(to_remote_form_input(input, action_id), {
					remote_refreshes: [],
				}).blob,
		);
		const data = yield* MakeEffectFromPromise<unknown, ErrorType>((signal) =>
			remote_transport.remote_request(url, {
				method: "POST",
				headers: {
					...get_remote_request_headers(),
					"Content-Type": remote_transport.binary_form_content_type,
				},
				body,
				signal,
			}),
		);

		return yield* DecodeKitFormData<Output, ErrorType>(data, decode_payload, remote_transport);
	});

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
	const normalized_base = remote_base.replace(/\/$/, "");

	return `${normalized_base}/${head}`;
}

function to_remote_form_input(input: unknown, action_id: string): Record<string, unknown> {
	const data = is_record(input) ? input : {};
	const serialized_key = action_id.split("/").slice(2).join("/");
	const key: unknown = serialized_key.length === 0 ? undefined : JSON.parse(serialized_key);

	if (key === undefined || data.id !== undefined) {
		return data;
	}

	return {
		...data,
		id: key,
	};
}

function get_remote_request_headers(): Record<string, string> {
	if (typeof location === "undefined") {
		return {};
	}

	return {
		"x-sveltekit-pathname": location.pathname,
		"x-sveltekit-search": location.search,
	};
}

const ValidatePreflightInput = <ErrorType>(schema: StandardSchema | undefined, input: unknown) =>
	Effect.gen(function* () {
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

const DecodeFormResponse = <Output, ErrorType>(
	envelope: unknown,
	decode_payload: (value: unknown) => unknown,
	remote_transport: RemoteFormTransport,
) =>
	Effect.gen(function* () {
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
				create_remote_http_error(get_remote_form_error_status(response), response.error),
			);
		}

		if (response._tag === "RemoteFormRedirectEnvelope") {
			return yield* NavigateRemoteForm<ErrorType>(
				response.location,
				true,
				remote_transport,
				envelope,
			);
		}

		const parsed = yield* MakeEffectFromSync<unknown, ErrorType>(() =>
			parse(response.data, remote_transport.decoders),
		);
		const redirect_data = DecodeRemoteFormRedirectData(parsed);

		if (Option.isSome(redirect_data)) {
			return yield* NavigateRemoteForm<ErrorType>(
				redirect_data.value.redirect,
				true,
				remote_transport,
				envelope,
			);
		}

		const result_data = DecodeRemoteFormResultData(parsed);

		if (!Option.isSome(result_data)) {
			return yield* Effect.fail(
				create_remote_transport_error(
					new UnsupportedRemoteFormResponseError(envelope),
					envelope,
				),
			);
		}

		const payload = yield* MakeEffectFromSync<unknown, ErrorType>(() =>
			decode_payload(result_data.value._),
		);
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

		yield* RefreshRemoteFormState<ErrorType>(remote_transport);

		return decoded.result as Output;
	});

const DecodeKitFormData = <Output, ErrorType>(
	data: unknown,
	decode_payload: (value: unknown) => unknown,
	remote_transport: RemoteFormTransport,
) =>
	Effect.gen(function* () {
		const decoded_data = DecodeKitRemoteFormData(data);

		if (!Option.isSome(decoded_data)) {
			return yield* Effect.fail(
				create_remote_transport_error(new UnsupportedRemoteFormResponseError(data), data),
			);
		}

		const should_invalidate = decoded_data.value.r !== true;

		if (decoded_data.value.redirect) {
			return yield* NavigateRemoteForm<ErrorType>(
				decoded_data.value.redirect,
				should_invalidate,
				remote_transport,
				data,
			);
		}

		if (!("_" in decoded_data.value)) {
			return yield* Effect.fail(
				create_remote_transport_error(new UnsupportedRemoteFormResponseError(data), data),
			);
		}

		const payload = yield* MakeEffectFromSync<unknown, ErrorType>(() =>
			decode_payload(decoded_data.value._),
		);
		const decoded = decode_remote_form_payload<Output>(payload);

		if (!decoded) {
			return yield* Effect.fail(
				create_remote_transport_error(new UnsupportedRemoteFormResponseError(data), data),
			);
		}

		if (decoded.issues && decoded.issues.length > 0) {
			return yield* Effect.fail(create_remote_validation_error(decoded.issues, decoded, 400));
		}

		if (should_invalidate) {
			yield* RefreshRemoteFormState<ErrorType>(remote_transport);
		}

		return decoded.result as Output;
	});

const NavigateRemoteForm = <ErrorType>(
	location: string,
	invalidate_all: boolean,
	remote_transport: RemoteFormTransport,
	envelope: unknown,
) =>
	Effect.gen(function* () {
		const navigate = remote_transport.navigate;

		if (!navigate) {
			return yield* Effect.fail(
				create_remote_transport_error(
					new UnsupportedRemoteFormResponseError(envelope),
					envelope,
				),
			);
		}

		yield* MakeEffectFromPromise<void, ErrorType>(() =>
			Promise.resolve(navigate(location, invalidate_all)),
		);

		return yield* Effect.interrupt;
	});

const RefreshRemoteFormState = <ErrorType>(remote_transport: RemoteFormTransport) =>
	Effect.gen(function* () {
		const refresh = remote_transport.refresh;

		if (!refresh) {
			return;
		}

		yield* MakeEffectFromPromise<void, ErrorType>(() => Promise.resolve(refresh()));
	});

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

	if (decoded.value.type === "redirect") {
		return {
			_tag: "RemoteFormRedirectEnvelope",
			location: decoded.value.location,
		};
	}

	return {
		_tag: "RemoteFormResultEnvelope",
		data: decoded.value.data,
	};
}

function get_remote_form_error_status(
	response: Extract<RemoteFormResponseEnvelope, { _tag: "RemoteFormErrorEnvelope" }>,
): number {
	const nested_status = is_record(response.error) ? response.error.status : undefined;

	if (response.status !== undefined) {
		return response.status;
	}

	return typeof nested_status === "number" ? nested_status : 500;
}

function is_kit_remote_form_transport(
	remote_transport: RemoteFormTransport,
): remote_transport is KitRemoteFormTransport {
	return (
		typeof remote_transport.binary_form_content_type === "string" &&
		typeof remote_transport.remote_request === "function" &&
		typeof remote_transport.serialize_binary_form === "function"
	);
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
