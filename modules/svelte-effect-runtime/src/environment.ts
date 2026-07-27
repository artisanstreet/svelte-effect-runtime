import type { EnvVarConfig } from "@sveltejs/kit";
import { Schema } from "effect";

export type StandardSchema<Output = unknown> = NonNullable<EnvVarConfig<Output>["schema"]>;

export type EnvironmentSchema =
	| (Schema.ConstraintDecoder<unknown, never> & {
			readonly Encoded: string | undefined;
	  })
	| StandardSchema<unknown>;

export type EnvironmentSchemaOutput<S extends EnvironmentSchema> = S extends Schema.Constraint
	? S["Type"]
	: S extends StandardSchema<infer Output>
		? Output
		: never;

/** One environment variable declaration, accepting Effect Schema or Standard Schema. */
export interface EnvironmentVariable<S extends EnvironmentSchema = EnvironmentSchema> {
	readonly public?: boolean;
	readonly static?: boolean;
	readonly description?: string;
	readonly schema?: S;
}

export type EnvironmentDefinition = Record<string, EnvironmentVariable>;

export type EnvironmentVariables<Definition extends EnvironmentDefinition> = {
	readonly [Name in keyof Definition]: Omit<Definition[Name], "schema"> &
		(Definition[Name]["schema"] extends EnvironmentSchema
			? { readonly schema: StandardSchema<EnvironmentSchemaOutput<Definition[Name]["schema"]>> }
			: { readonly schema?: undefined });
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
