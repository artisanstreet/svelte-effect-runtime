import { decode_remote_error, is_decoded_remote_failure } from "./failures.ts";
import { create_remote_http_error } from "$/remote/shared.ts";
import type { RemoteFailure } from "$/remote/shared.ts";

/**
 * Decodes a failed fetch response into the runtime failure model.
 *
 * @example
 * ```ts
 * const failure = await decode_response_failure(response);
 * ```
 *
 * @since 2.0.0
 * @param response - Failed fetch response returned by the remote endpoint.
 * @returns Remote failure represented by the response.
 */
export async function decode_response_failure<ErrorType = never>(
	response: Response,
): Promise<RemoteFailure<ErrorType>> {
	const body = await response.json().catch(() => undefined);
	const decoded = decode_remote_error<ErrorType>(body);

	if (is_decoded_remote_failure(decoded)) {
		return decoded;
	}

	return create_remote_http_error(response.status, body);
}

/**
 * Decodes either a raw value or `Response` returned by a native remote helper.
 *
 * @example
 * ```ts
 * const output = await decode_response_or_value(result, decode_payload);
 * ```
 *
 * @since 2.0.0
 * @param value - Native result value or fetch response.
 * @param decode_payload - Function used to decode successful payloads.
 * @returns Decoded successful output.
 */
export async function decode_response_or_value<Output, ErrorType = never>(
	value: unknown,
	decode_payload: (value: unknown) => unknown,
): Promise<Output> {
	if (value instanceof Response) {
		if (!value.ok) {
			throw await decode_response_failure<ErrorType>(value);
		}

		const data = await decode_success_response_body(value);

		return decode_payload(data) as Output;
	}

	return decode_payload(value) as Output;
}

async function decode_success_response_body(response: Response): Promise<unknown> {
	if (response.status === 204 || response.status === 205) {
		return undefined;
	}

	const text = await response.text();

	if (text.length === 0) {
		return undefined;
	}

	return JSON.parse(text);
}
