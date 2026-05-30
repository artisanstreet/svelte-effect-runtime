import { Schema } from "effect";

import type { RemoteHandler, StandardSchema } from "./types.ts";

/**
 * Checks whether a value is the string sentinel for unchecked remotes.
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
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value is callable as a handler.
 */
export function is_handler(value: unknown): value is RemoteHandler {
  return typeof value === "function";
}

/**
 * Checks whether a value implements the Standard Schema contract.
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value is a Standard Schema.
 */
export function is_standard_schema(value: unknown): value is StandardSchema {
  return (
    typeof value === "object" &&
    value !== null &&
    "~standard" in value
  );
}

/**
 * Checks whether a value looks like an Effect Schema.
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value should be converted to Standard Schema.
 */
export function is_effect_schema(
  value: unknown,
): value is Schema.Schema<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ast" in value &&
    "make" in value
  );
}

/**
 * Converts Effect Schema inputs to Standard Schema for SvelteKit.
 *
 * @since 2.0.0
 * @param value - Schema or handler input.
 * @returns Original value or Standard Schema view of an Effect Schema.
 */
export function normalize_validator(value: unknown): unknown {
  if (is_standard_schema(value) || !is_effect_schema(value)) {
    return value;
  }

  return Schema.toStandardSchemaV1(value as never);
}
