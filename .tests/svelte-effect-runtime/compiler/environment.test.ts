import {
	find_environment_exports,
	make_environment_module,
	make_environment_types,
} from "../../../modules/svelte-effect-runtime/src/compiler/environment.ts";
import { assert_equals, assert_string_includes } from "../unit/helpers/assert.ts";
import { test } from "vitest";

test("finds named SvelteKit environment exports", () => {
	const names = find_environment_exports(
		[
			`import { dynamic_private_env as env } from "__sveltekit/env";`,
			`export const DATABASE_URL = env.DATABASE_URL;`,
			`export const PORT = 4173;`,
		].join("\n"),
	);

	assert_equals(names, ["DATABASE_URL", "PORT"]);
});

test("generates yieldable private environment exports", () => {
	const module = make_environment_module("private", ["DATABASE_URL", "PORT"]);

	assert_string_includes(module, `import * as environment_values from "$app/env/private";`);
	assert_string_includes(
		module,
		`export const DATABASE_URL = Effect.succeed(environment_values.DATABASE_URL);`,
	);
	assert_string_includes(module, `export const PORT = Effect.succeed(environment_values.PORT);`);
});

test("generates yieldable public environment exports", () => {
	const module = make_environment_module("public", ["PUBLIC_ORIGIN"]);

	assert_string_includes(module, `import * as environment_values from "$app/env/public";`);
	assert_string_includes(
		module,
		`export const PUBLIC_ORIGIN = Effect.succeed(environment_values.PUBLIC_ORIGIN);`,
	);
});

test("maps SvelteKit environment declarations to Effect types", () => {
	const types = make_environment_types();

	assert_string_includes(types, `declare module "$ser/env/private"`);
	assert_string_includes(types, `declare module "$ser/env/public"`);
	assert_string_includes(types, `import("effect").Effect.Effect<Source[Name]>`);
});
