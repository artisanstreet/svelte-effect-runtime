import type { RemoteHandler } from "./types.ts";

export {
	is_effect_schema,
	is_standard_schema,
	normalize_validator,
	type StandardSchema,
} from "$/internal/schema.ts";

export function is_unchecked(value: unknown): value is "unchecked" {
	return value === "unchecked";
}

export function is_handler(
	value: unknown,
): value is RemoteHandler<unknown, unknown, unknown, unknown> {
	return typeof value === "function";
}
