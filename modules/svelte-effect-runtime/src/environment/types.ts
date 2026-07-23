import type { EnvVarConfig } from "@sveltejs/kit";
import type { Schema } from "effect";

export type StandardSchema<Output = unknown> = NonNullable<EnvVarConfig<Output>["schema"]>;

export type EnvironmentSchema =
	| (Schema.ConstraintDecoder<unknown, never> & {
			readonly Encoded: string | undefined;
	  })
	| StandardSchema<unknown>;

export type SchemaOutput<S extends EnvironmentSchema> = S extends Schema.Constraint
	? S["Type"]
	: S extends StandardSchema<infer Output>
		? Output
		: never;

export type NormalizedSchema<S extends EnvironmentSchema> =
	S extends Schema.ConstraintDecoder<unknown, never> ? StandardSchema<S["Type"]> & S : S;

/** Metadata SvelteKit applies after validating an environment variable. */
export interface EnvironmentOptions {
	readonly description?: string;
	readonly static?: boolean;
}

export type EnvironmentVariable<
	S extends EnvironmentSchema = EnvironmentSchema,
	Public extends boolean = boolean,
> = EnvironmentOptions & {
	readonly public: Public;
	readonly schema: NormalizedSchema<S>;
};

export type EnvironmentDefinition = Record<string, EnvironmentVariable<EnvironmentSchema, boolean>>;

/** Public surface for Effect Schema-backed SvelteKit environment declarations. */
export interface EnvApi {
	/** Creates the `variables` declaration exported from `src/env.ts`. */
	readonly make: <const Definition extends EnvironmentDefinition>(
		definition: Definition,
	) => Definition;

	/** Declares a server-only environment variable. */
	readonly private: <const S extends EnvironmentSchema>(
		schema: S,
		options?: EnvironmentOptions,
	) => EnvironmentVariable<S, false>;

	/** Declares an environment variable that may be exposed to browser code. */
	readonly public: <const S extends EnvironmentSchema>(
		schema: S,
		options?: EnvironmentOptions,
	) => EnvironmentVariable<S, true>;
}
