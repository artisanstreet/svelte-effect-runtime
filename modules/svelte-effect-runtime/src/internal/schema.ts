import { Schema } from "effect";

export type StandardSchema = {
	readonly "~standard": {
		readonly types?: {
			readonly input: unknown;
			readonly output: unknown;
		};
		readonly validate: (input: unknown) => unknown;
	};
};

export function is_standard_schema(value: unknown): value is StandardSchema {
	return typeof value === "object" && value !== null && "~standard" in value;
}

export function is_effect_schema(value: unknown): value is Schema.Schema<unknown> {
	return Schema.isSchema(value);
}

export function normalize_validator(value: unknown): unknown {
	if (is_standard_schema(value) || !is_effect_schema(value)) {
		return value;
	}

	return Schema.toStandardSchemaV1(value as never);
}
