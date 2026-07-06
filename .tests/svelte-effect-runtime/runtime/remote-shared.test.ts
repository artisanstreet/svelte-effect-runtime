import { test } from "vitest";
import { assert_false, assert_truthy, assert_equals } from "./helpers/assert.ts";
import {
	EFFECT_REMOTE_ERROR_MARKER,
	REMOTE_ERROR_DECODER,
	create_form_error,
	is_form_error,
	create_remote_validation_error,
	create_remote_http_error,
	create_remote_transport_error,
	create_serialized_remote_failure_envelope,
	is_serialized_remote_failure_envelope,
	is_remote_validation_error,
	is_remote_http_error,
	is_remote_transport_error,
} from "../../../modules/svelte-effect-runtime/src/remote/shared.ts";

// ─── Markers ───────────────────────────────────────────────────

test("EFFECT_REMOTE_ERROR_MARKER is the expected string", () => {
	assert_equals(EFFECT_REMOTE_ERROR_MARKER, "__svelte_effect_remote__");
});

test("REMOTE_ERROR_DECODER is a symbol", () => {
	assert_equals(typeof REMOTE_ERROR_DECODER, "symbol");
});

// ─── FormError ─────────────────────────────────────────────────

test("create_form_error produces a FormError with _tag", () => {
	const err = create_form_error([{ message: "required", path: ["name"] }]);

	assert_equals(err._tag, "FormError");
	assert_equals(err.issues.length, 1);
	assert_equals(err.issues[0].message, "required");
	assert_equals(err.issues[0].path, ["name"]);
});

test("create_form_error accepts multiple issues", () => {
	const err = create_form_error([
		{ message: "too short", path: ["name"] },
		{ message: "invalid", path: ["email"] },
	]);

	assert_equals(err.issues.length, 2);
});

test("is_form_error returns true for FormError", () => {
	const err = create_form_error([{ message: "x", path: [] }]);
	assert_truthy(is_form_error(err));
});

test("is_form_error returns false for plain objects", () => {
	assert_false(is_form_error({ _tag: "Other" }));
	assert_false(is_form_error({}));
	assert_false(is_form_error(null));
	assert_false(is_form_error("FormError"));
	assert_false(is_form_error(undefined));
});

// ─── Remote error constructors ─────────────────────────────────

test("create_remote_validation_error builds correct shape", () => {
	const err = create_remote_validation_error([{ message: "bad", path: ["field"] }]);

	assert_equals(err._tag, "RemoteValidationError");
	assert_equals(err.status, 400);
	assert_equals(err.issues!.length, 1);
});

test("create_remote_validation_error accepts custom status", () => {
	const err = create_remote_validation_error([{ message: "bad", path: [] }], undefined, 422);

	assert_equals(err.status, 422);
});

test("create_remote_validation_error forwards body", () => {
	const body = { detail: "nope" };
	const err = create_remote_validation_error([{ message: "bad", path: [] }], body);

	assert_equals(err.body, body);
});

test("create_remote_http_error builds correct shape", () => {
	const err = create_remote_http_error(404, "Not found");

	assert_equals(err._tag, "RemoteHttpError");
	assert_equals(err.status, 404);
	assert_equals(err.body, "Not found");
});

test("create_remote_http_error defaults body to undefined", () => {
	const err = create_remote_http_error(500);

	assert_equals(err.status, 500);
	assert_equals(err.body, undefined);
});

test("create_remote_transport_error builds correct shape", () => {
	const err = create_remote_transport_error(new Error("network down"), "raw body");

	assert_equals(err._tag, "RemoteTransportError");
	assert_truthy(err.cause instanceof Error);
	assert_equals(err.body, "raw body");
});

// ─── Serialised failure envelopes ──────────────────────────────

test("create_serialized_remote_failure_envelope wraps encoded string", () => {
	const env = create_serialized_remote_failure_envelope('{"msg":"fail"}');

	assert_equals(env.__svelte_effect_remote__, true);
	assert_equals(env.encoded, '{"msg":"fail"}');
});

test("is_serialized_remote_failure_envelope detects marker", () => {
	const env = create_serialized_remote_failure_envelope("x");
	assert_truthy(is_serialized_remote_failure_envelope(env));
});

test("is_serialized_remote_failure_envelope rejects non-envelopes", () => {
	assert_false(is_serialized_remote_failure_envelope({}));
	assert_false(is_serialized_remote_failure_envelope({ __svelte_effect_remote__: false }));
	assert_false(is_serialized_remote_failure_envelope(null));
});

// ─── Type guards ───────────────────────────────────────────────

test("is_remote_validation_error detects validation errors", () => {
	const err = create_remote_validation_error([]);
	assert_truthy(is_remote_validation_error(err));
	assert_false(is_remote_validation_error({ _tag: "Other" }));
});

test("is_remote_http_error detects HTTP errors", () => {
	const err = create_remote_http_error(500);
	assert_truthy(is_remote_http_error(err));
	assert_false(is_remote_http_error({ _tag: "RemoteValidationError" }));
});

test("is_remote_transport_error detects transport errors", () => {
	const err = create_remote_transport_error("fail");
	assert_truthy(is_remote_transport_error(err));
	assert_false(is_remote_transport_error(new Error()));
});
