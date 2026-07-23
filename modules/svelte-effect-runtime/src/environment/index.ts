import type {
	EnvApi,
	EnvironmentDefinition,
	EnvironmentOptions,
	EnvironmentSchema,
	EnvironmentVariable,
	NormalizedSchema,
} from "./types.ts";
import { Schema } from "effect";

/**
 * Effect Schema-backed environment declarations for SvelteKit.
 *
 * Export the result of {@link Env.make} as `variables` from `src/env.ts`, then
 * yield validated values from `$ser/env/public` or `$ser/env/private`.
 *
 * @example
 * ```ts
 * import { Env } from "svelte-effect-runtime/environment";
 * import { Schema } from "effect";
 *
 * export const variables = Env.make({
 *   PORT: Env.private(Schema.NumberFromString),
 *   PUBLIC_ORIGIN: Env.public(Schema.URLFromString),
 * });
 * ```
 *
 * @since 4.2.0
 */
export const Env: EnvApi = {
	make,
	private: private_environment,
	public: public_environment,
};

function make<const Definition extends EnvironmentDefinition>(definition: Definition): Definition {
	return definition;
}

function private_environment<const S extends EnvironmentSchema>(
	schema: S,
	options?: EnvironmentOptions,
): EnvironmentVariable<S, false> {
	const normalized_schema = normalize_schema(schema);

	return {
		...options,
		public: false,
		schema: normalized_schema,
	};
}

function public_environment<const S extends EnvironmentSchema>(
	schema: S,
	options?: EnvironmentOptions,
): EnvironmentVariable<S, true> {
	const normalized_schema = normalize_schema(schema);

	return {
		...options,
		public: true,
		schema: normalized_schema,
	};
}

function normalize_schema<const S extends EnvironmentSchema>(schema: S): NormalizedSchema<S> {
	if (!Schema.isSchema(schema)) {
		return schema as NormalizedSchema<S>;
	}

	return Schema.toStandardSchemaV1(
		schema as Schema.ConstraintDecoder<unknown, never>,
	) as NormalizedSchema<S>;
}

export type {
	EnvApi,
	EnvironmentDefinition,
	EnvironmentOptions,
	EnvironmentSchema,
	EnvironmentVariable,
	SchemaOutput,
} from "./types.ts";
