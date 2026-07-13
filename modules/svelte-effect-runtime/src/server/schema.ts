import type { RemoteHandler } from "./types.ts";

export {
	is_effect_schema,
	is_standard_schema,
	normalize_validator,
	type StandardSchema,
} from "$/internal/schema.ts";

/**
 * Checks whether a value is the string sentinel for unchecked remotes.
 *
 * @example
 * ```ts
 * if (is_unchecked(validator)) {
 *   return handler;
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value is `"unchecked"`.
 */
export function is_unchecked(value: unknown): value is "unchecked" {
	return value === "unchecked";
}

/**
 * Checks whether a value is a remote handler function.
 *
 * @example
 * ```ts
 * if (is_handler(candidate)) {
 *   return candidate(input);
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value is callable as a handler.
 */
export function is_handler(
	value: unknown,
): value is RemoteHandler<unknown, unknown, unknown, unknown> {
	return typeof value === "function";
}
