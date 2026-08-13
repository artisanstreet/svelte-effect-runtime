import type { StandardSchemaV1 } from "@sveltejs/kit/internal/types";
import { Schema } from "effect";

/**
 * The Standard Schema validator shape SvelteKit accepts for an environment
 * variable. Mirrors `EnvVarConfig["schema"]` structurally rather than
 * importing it, because SvelteKit 2 declares `EnvVarConfig` in
 * `@sveltejs/kit` while SvelteKit 3 (since `3.0.0-next.20`) declares it only
 * in `@sveltejs/kit/env`.
 *
 * @since 4.2.0
 */
export type StandardSchema<Output = unknown> =
	| StandardSchemaV1<string | undefined, Output>
	| ((value: string | undefined) => Output | undefined);

/**
 * A validator accepted by {@link DefineEnvVars}: an Effect Schema that decodes
 * synchronously from the raw string value, or an existing Standard Schema.
 *
 * @since 4.2.0
 */
export type EnvironmentSchema =
	| (Schema.ConstraintDecoder<unknown, never> & {
			readonly Encoded: string | undefined;
	  })
	| StandardSchema<unknown>;

/**
 * The decoded output type an environment schema produces.
 *
 * @since 4.2.0
 */
export type EnvironmentSchemaOutput<S extends EnvironmentSchema> = S extends Schema.Constraint
	? S["Type"]
	: S extends StandardSchema<infer Output>
		? Output
		: never;

/**
 * One environment variable declaration: SvelteKit's metadata plus an Effect
 * Schema or Standard Schema validator.
 *
 * @since 4.2.0
 */
export interface EnvironmentVariable<S extends EnvironmentSchema = EnvironmentSchema> {
	readonly public?: boolean;
	readonly static?: boolean;
	readonly description?: string;
	readonly schema?: S;
}

/**
 * Environment variable declarations keyed by variable name.
 *
 * @since 4.2.0
 */
export type EnvironmentDefinition = Record<string, EnvironmentVariable>;

/**
 * The normalized declarations {@link DefineEnvVars} returns, with every Effect
 * Schema converted to a Standard Schema of the same decoded output type.
 *
 * @since 4.2.0
 */
export type EnvironmentVariables<Definition extends EnvironmentDefinition> = {
	readonly [Name in keyof Definition]: Omit<Definition[Name], "schema"> &
		NormalizedVariableSchema<Definition[Name]["schema"]>;
};

/** Keeps the schema member sound when a declaration's schema type includes undefined. */
type NormalizedVariableSchema<S> = [S] extends [EnvironmentSchema]
	? { readonly schema: StandardSchema<EnvironmentSchemaOutput<S>> }
	: [S] extends [undefined]
		? { readonly schema?: undefined }
		: {
				readonly schema?: StandardSchema<
					EnvironmentSchemaOutput<Extract<S, EnvironmentSchema>>
				>;
			};

/**
 * Declares SvelteKit environment variables with Effect Schema validators.
 *
 * A thin wrapper over SvelteKit's `defineEnvVars` that converts Effect Schemas
 * to the Standard Schema interface SvelteKit validates at startup. Standard
 * Schema validators and schema-less declarations pass through unchanged, and
 * SvelteKit remains responsible for loading, visibility, and validation.
 * Schemas must decode synchronously from the raw string value.
 *
 * @example
 * ```ts
 * // src/env.ts
 * import { DefineEnvVars } from "svelte-effect-runtime/environment";
 * import { Schema } from "effect";
 *
 * export const variables = DefineEnvVars({
 *   PORT: { schema: Schema.NumberFromString, description: "Server port." },
 *   PUBLIC_ORIGIN: { public: true, schema: Schema.URLFromString },
 * });
 * ```
 *
 * @since 4.2.0
 * @param definition - Environment variable declarations keyed by variable name,
 * each carrying SvelteKit's metadata plus an Effect Schema or Standard Schema.
 * @returns The same declarations with every Effect Schema converted to a
 * Standard Schema, ready to export as `variables` from `src/env.ts`.
 */
export function DefineEnvVars<const Definition extends EnvironmentDefinition>(
	definition: Definition,
): EnvironmentVariables<Definition> {
	const entries = Object.entries(definition).map(([name, variable]) => [
		name,
		normalize_variable(variable),
	]);

	return Object.fromEntries(entries) as EnvironmentVariables<Definition>;
}

function normalize_variable(variable: EnvironmentVariable): EnvironmentVariable {
	if (variable.schema === undefined || !Schema.isSchema(variable.schema)) {
		return variable;
	}

	return {
		...variable,
		schema: Schema.toStandardSchemaV1(
			variable.schema as Schema.ConstraintDecoder<unknown, never>,
		) as StandardSchema,
	};
}
