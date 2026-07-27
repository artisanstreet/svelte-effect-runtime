import { DefineEnvVars } from "../../../modules/svelte-effect-runtime/src/environment.ts";
import { DefineEnvVars as RootDefineEnvVars } from "../../../modules/svelte-effect-runtime/src/mod.ts";
import { assert_equals } from "../unit/helpers/assert.ts";
import { Schema } from "effect";
import { test } from "vitest";

test("DefineEnvVars preserves SvelteKit environment metadata", () => {
	const variables = DefineEnvVars({
		PORT: {
			schema: Schema.NumberFromString,
			description: "Application port",
			static: true,
		},
		PUBLIC_ORIGIN: {
			public: true,
			schema: Schema.URLFromString,
		},
	});

	assert_equals(variables.PORT.public, undefined);
	assert_equals(variables.PORT.static, true);
	assert_equals(variables.PORT.description, "Application port");
	assert_equals(variables.PUBLIC_ORIGIN.public, true);
});

test("DefineEnvVars is available from the root and environment entrypoints", () => {
	assert_equals(RootDefineEnvVars, DefineEnvVars);
});

test("DefineEnvVars converts Effect Schemas to synchronous Standard Schemas", () => {
	const variables = DefineEnvVars({
		PORT: { schema: Schema.NumberFromString },
		PUBLIC_ORIGIN: { public: true, schema: Schema.URLFromString },
	});
	const port_result = variables.PORT.schema["~standard"].validate("4173");
	const origin_result =
		variables.PUBLIC_ORIGIN.schema["~standard"].validate("https://example.com");

	if (port_result instanceof Promise || origin_result instanceof Promise) {
		throw new Error("environment schemas must validate synchronously");
	}

	if (port_result.issues || origin_result.issues) {
		throw new Error("valid environment values should decode");
	}

	assert_equals(port_result.value, 4173);
	assert_equals(origin_result.value.href, "https://example.com/");
});

test("DefineEnvVars preserves existing Standard Schema validators", () => {
	const standard_schema = Schema.toStandardSchemaV1(Schema.Trim);
	const variables = DefineEnvVars({
		NAME: { schema: standard_schema },
	});

	assert_equals(variables.NAME.schema, standard_schema);
});

test("DefineEnvVars passes schema-less declarations through unchanged", () => {
	const variables = DefineEnvVars({
		NAME: { description: "Plain non-empty string" },
	});

	assert_equals(variables.NAME.schema, undefined);
	assert_equals(variables.NAME.description, "Plain non-empty string");
});
