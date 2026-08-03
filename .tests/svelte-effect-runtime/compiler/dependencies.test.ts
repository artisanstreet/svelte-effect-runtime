import { collect_free_identifiers } from "../../../modules/svelte-effect-runtime/src/markup/transform/expressions.ts";
import { transform_script_effect } from "../../../modules/svelte-effect-runtime/src/script-transform/index.ts";
import { assert_equals, assert_not_match, assert_string_includes } from "../unit/helpers/assert.ts";
import { test } from "vitest";

/**
 * Dependency collection decides which values a lowered effect re-reads. A name
 * that is collected but never declared makes the generated code throw, and a
 * name that is missed makes the effect stop re-running with no error at all.
 */

test("a method name and its parameters are not dependencies", () => {
	assert_equals(collect_free_identifiers(`({ render(item) { return item; } })`), []);
	assert_equals(collect_free_identifiers(`(class { render(item) { return item; } })`), []);
	assert_equals(collect_free_identifiers(`({ get value() { return alpha; } })`), ["alpha"]);
	assert_equals(collect_free_identifiers(`({ set value(next) { alpha = next; } })`), ["alpha"]);
});

test("a computed member name stays a dependency", () => {
	assert_equals(collect_free_identifiers(`({ [key](item) { return item; } })`), ["key"]);
});

test("a parameter default is a dependency", () => {
	assert_equals(collect_free_identifiers(`(limit = fallback) => limit`), ["fallback"]);
	assert_equals(collect_free_identifiers(`(limit = limit) => limit`), []);
});

test("a loop binding does not swallow an equally named dependency", () => {
	assert_equals(
		collect_free_identifiers(`(() => { for (const item of item) { return 1; } })()`),
		["item"],
	);
});

test("a block scoped declaration does not leak past its block", () => {
	assert_equals(collect_free_identifiers(`(() => { { const total = 1; } return total; })()`), [
		"total",
	]);
});

test("statement text never yields a nameless dependency", () => {
	const identifiers = collect_free_identifiers(
		`for (const entry of yield* Load()) { record(entry); }`,
	);

	assert_equals(identifiers, ["Load", "record"]);
});

test("generated dependency reads only reference declared bindings", () => {
	const source = `const saved = yield* Save({ render(item) { return item; } });`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_string_includes(result.code, `deps: [Save]`);
	assert_not_match(result.code, /deps: \[[^\]]*\brender\b/);
	assert_not_match(result.code, /deps: \[[^\]]*\bitem\b/);
});

test("generated effect blocks contain no empty dependency statement", () => {
	const source = `for (const entry of yield* Load()) { record(entry); }`;
	const result = transform_script_effect(source, "Test.svelte");

	assert_not_match(result.code, /^\s*;\s*$/m);
	assert_string_includes(result.code, "  Load;");
	assert_string_includes(result.code, "  record;");
});
