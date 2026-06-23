import {
  create_remote_http_error,
  create_remote_transport_error,
  create_remote_validation_error,
} from "$/remote/shared.ts";
import type { FormIssue } from "$/remote/shared.ts";
import { parse } from "devalue";

import { decode_remote_error, is_decoded_remote_failure } from "./failures.ts";
import { decode_response_failure } from "./responses.ts";
import { to_form_data } from "./form-data.ts";
import type { NativeFormRecord } from "./types.ts";

/**
 * Submits a native remote form through the SvelteKit remote endpoint.
 *
 * @since 2.0.0
 * @param form_obj - Native form object being adapted.
 * @param input - Form input value.
 * @param decode_payload - Function to decode successful payloads.
 * @param remote_base - Base URL for the remote endpoint.
 * @returns Decoded form output.
 */
export async function submit_remote_form<Output>(
  form_obj: NativeFormRecord,
  input: unknown,
  decode_payload: (value: unknown) => unknown,
  remote_base: string,
): Promise<Output> {
  const action_id = get_remote_action_id(form_obj);

  if (!action_id || remote_base.length === 0) {
    throw create_remote_transport_error(
      new Error("Form has no submit method or remote endpoint"),
    );
  }

  const response = await fetch(to_remote_form_url(remote_base, action_id), {
    method: "POST",
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
export function get_remote_action_id(
  form_obj: NativeFormRecord,
): string | undefined {
  const action = form_obj.action;

  if (typeof action !== "string") {
    return undefined;
  }

  const fallback = "http://localhost/";
  const href = typeof location === "undefined" ? fallback : location.href;
  const url = new URL(action, href);

  return url.searchParams.get("/remote") ??
    url.searchParams.get("remote") ??
    undefined;
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

function decode_form_response<Output>(
  envelope: unknown,
  decode_payload: (value: unknown) => unknown,
): Output {
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("type" in envelope)
  ) {
    throw create_remote_transport_error(
      new Error("Invalid remote form response"),
      envelope,
    );
  }

  const response = envelope as {
    data?: unknown;
    type: string;
    result?: unknown;
    error?: unknown;
    status?: number;
  };

  if (response.type === "error") {
    const decoded = decode_remote_error(response.error);

    if (is_decoded_remote_failure(decoded)) {
      throw decoded;
    }

    throw create_remote_http_error(
      response.status ?? 500,
      response.error,
    );
  }

  const result_text = typeof response.result === "string"
    ? response.result
    : typeof response.data === "string"
    ? response.data
    : undefined;

  if (response.type !== "result" || result_text === undefined) {
    throw create_remote_transport_error(
      new Error("Unsupported remote form response"),
      envelope,
    );
  }

  const parsed = parse(result_text);
  const decoded = decode_payload(parsed) as {
    issues?: readonly FormIssue[];
    result?: Output;
  };

  if (decoded.issues && decoded.issues.length > 0) {
    throw create_remote_validation_error(decoded.issues, decoded, 400);
  }

  return decoded.result as Output;
}
