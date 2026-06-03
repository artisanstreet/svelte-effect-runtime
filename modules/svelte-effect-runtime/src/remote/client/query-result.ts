import { decode_response_or_value } from "./responses.ts";
import { has_method } from "./utils.ts";

/**
 * Resolves native query results, including SvelteKit run handles.
 *
 * @example
 * ```ts
 * const output = await resolve_query_result(result, decode_payload);
 * ```
 *
 * @since 2.0.0
 * @param value - Native query result or query run handle.
 * @param decode_payload - Function used to decode successful payloads.
 * @returns Decoded query output.
 */
export async function resolve_query_result<Output>(
  value: unknown,
  decode_payload: (value: unknown) => unknown,
): Promise<Output> {
  if (has_method(value, "then")) {
    const result = await Promise.resolve(value);

    return decode_response_or_value(result, decode_payload);
  }

  if (has_method(value, "run")) {
    const result = await value.run();

    return decode_response_or_value(result, decode_payload);
  }

  const result = await Promise.resolve(value);

  return decode_response_or_value(result, decode_payload);
}
