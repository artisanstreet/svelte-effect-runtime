import { Schema } from "effect";

/**
 * Minimal Standard Schema shape accepted by SvelteKit remote helpers.
 *
 * @example
 * ```ts
 * const schema: StandardSchema = {
 *   "~standard": {
 *     validate: (input) => ({ value: input }),
 *   },
 * };
 * ```
 *
 * @since 2.0.0
 */
export type StandardSchema = {
	readonly "~standard": {
		readonly types?: {
			readonly input: unknown;
			readonly output: unknown;
		};
		readonly validate: (input: unknown) => unknown;
	};
};

/**
 * Checks whether a value implements the Standard Schema contract.
 *
 * @example
 * ```ts
 * if (is_standard_schema(value)) {
 *   value["~standard"].validate(input);
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value is a Standard Schema.
 */
export function is_standard_schema(value: unknown): value is StandardSchema {
	return typeof value === "object" && value !== null && "~standard" in value;
}

/**
 * Checks whether a value looks like an Effect Schema.
 *
 * @example
 * ```ts
 * if (is_effect_schema(value)) {
 *   Schema.toStandardSchemaV1(value);
 * }
 * ```
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value should be converted to Standard Schema.
 */
export function is_effect_schema(value: unknown): value is Schema.Schema<unknown> {
	return typeof value === "object" && value !== null && "ast" in value && "make" in value;
}

/**
 * Converts Effect Schema inputs to Standard Schema for SvelteKit.
 *
 * @example
 * ```ts
 * const validator = normalize_validator(Schema.Struct({ title: Schema.String }));
 * ```
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
