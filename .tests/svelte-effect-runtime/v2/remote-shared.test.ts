import { assert, assertEquals, assertFalse } from "@std/assert";
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

Deno.test("EFFECT_REMOTE_ERROR_MARKER is the expected string", () => {
  assertEquals(EFFECT_REMOTE_ERROR_MARKER, "__svelte_effect_remote__");
});

Deno.test("REMOTE_ERROR_DECODER is a symbol", () => {
  assertEquals(typeof REMOTE_ERROR_DECODER, "symbol");
});

// ─── FormError ─────────────────────────────────────────────────

Deno.test("create_form_error produces a FormError with _tag", () => {
  const err = create_form_error([
    { message: "required", path: ["name"] },
  ]);

  assertEquals(err._tag, "FormError");
  assertEquals(err.issues.length, 1);
  assertEquals(err.issues[0].message, "required");
  assertEquals(err.issues[0].path, ["name"]);
});

Deno.test("create_form_error accepts multiple issues", () => {
  const err = create_form_error([
    { message: "too short", path: ["name"] },
    { message: "invalid", path: ["email"] },
  ]);

  assertEquals(err.issues.length, 2);
});

Deno.test("is_form_error returns true for FormError", () => {
  const err = create_form_error([{ message: "x", path: [] }]);
  assert(is_form_error(err));
});

Deno.test("is_form_error returns false for plain objects", () => {
  assertFalse(is_form_error({ _tag: "Other" }));
  assertFalse(is_form_error({}));
  assertFalse(is_form_error(null));
  assertFalse(is_form_error("FormError"));
  assertFalse(is_form_error(undefined));
});

// ─── Remote error constructors ─────────────────────────────────

Deno.test("create_remote_validation_error builds correct shape", () => {
  const err = create_remote_validation_error(
    [{ message: "bad", path: ["field"] }],
  );

  assertEquals(err._tag, "RemoteValidationError");
  assertEquals(err.status, 400);
  assertEquals(err.issues!.length, 1);
});

Deno.test("create_remote_validation_error accepts custom status", () => {
  const err = create_remote_validation_error(
    [{ message: "bad", path: [] }],
    undefined,
    422,
  );

  assertEquals(err.status, 422);
});

Deno.test("create_remote_validation_error forwards body", () => {
  const body = { detail: "nope" };
  const err = create_remote_validation_error(
    [{ message: "bad", path: [] }],
    body,
  );

  assertEquals(err.body, body);
});

Deno.test("create_remote_http_error builds correct shape", () => {
  const err = create_remote_http_error(404, "Not found");

  assertEquals(err._tag, "RemoteHttpError");
  assertEquals(err.status, 404);
  assertEquals(err.body, "Not found");
});

Deno.test("create_remote_http_error defaults body to undefined", () => {
  const err = create_remote_http_error(500);

  assertEquals(err.status, 500);
  assertEquals(err.body, undefined);
});

Deno.test("create_remote_transport_error builds correct shape", () => {
  const err = create_remote_transport_error(
    new Error("network down"),
    "raw body",
  );

  assertEquals(err._tag, "RemoteTransportError");
  assert(err.cause instanceof Error);
  assertEquals(err.body, "raw body");
});

// ─── Serialised failure envelopes ──────────────────────────────

Deno.test("create_serialized_remote_failure_envelope wraps encoded string", () => {
  const env = create_serialized_remote_failure_envelope('{"msg":"fail"}');

  assertEquals(env.__svelte_effect_remote__, true);
  assertEquals(env.encoded, '{"msg":"fail"}');
});

Deno.test("is_serialized_remote_failure_envelope detects marker", () => {
  const env = create_serialized_remote_failure_envelope("x");
  assert(is_serialized_remote_failure_envelope(env));
});

Deno.test("is_serialized_remote_failure_envelope rejects non-envelopes", () => {
  assertFalse(is_serialized_remote_failure_envelope({}));
  assertFalse(is_serialized_remote_failure_envelope({ __svelte_effect_remote__: false }));
  assertFalse(is_serialized_remote_failure_envelope(null));
});

// ─── Type guards ───────────────────────────────────────────────

Deno.test("is_remote_validation_error detects validation errors", () => {
  const err = create_remote_validation_error([]);
  assert(is_remote_validation_error(err));
  assertFalse(is_remote_validation_error({ _tag: "Other" }));
});

Deno.test("is_remote_http_error detects HTTP errors", () => {
  const err = create_remote_http_error(500);
  assert(is_remote_http_error(err));
  assertFalse(is_remote_http_error({ _tag: "RemoteValidationError" }));
});

Deno.test("is_remote_transport_error detects transport errors", () => {
  const err = create_remote_transport_error("fail");
  assert(is_remote_transport_error(err));
  assertFalse(is_remote_transport_error(new Error()));
});
