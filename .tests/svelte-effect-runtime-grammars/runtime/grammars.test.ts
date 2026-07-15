import {
	assert_equals,
	assert_string_includes,
	assert_truthy,
} from "../../svelte-effect-runtime/unit/helpers/assert.ts";
import {
	TextMate,
	TreesitterQuery,
	textmate,
	textmate_language,
	tree_sitter,
} from "svelte-effect-runtime-grammars";
import { generate_tree_sitter_query_module } from "../../../build/grammar-query-codegen.ts";
import { readFile } from "node:fs/promises";
import { createHighlighter } from "shiki";
import { test } from "vitest";

test("exports a Shiki-ready TextMate injection grammar for Svelte", () => {
	assert_equals(TextMate, textmate);
	assert_equals(TreesitterQuery, tree_sitter);
	assert_equals(textmate.language, textmate_language);
	assert_equals(textmate.scope_name, "source.svelte.ser.injection");
	assert_equals(textmate.target_scope_name, "source.svelte");
	assert_equals(textmate_language.injectTo, ["source.svelte"]);
	assert_equals(textmate_language.embeddedLangs, ["typescript"]);
	assert_equals(textmate_language.injectionSelector, "L:source.svelte -comment -string");
});

test("grammar package loads tree-sitter queries from source assets", async () => {
	const highlights_query = await readFile(
		new URL(
			"../../../modules/svelte-effect-runtime-grammars/src/tree-sitter/highlights.tsq",
			import.meta.url,
		),
		"utf8",
	);
	const injections_query = await readFile(
		new URL(
			"../../../modules/svelte-effect-runtime-grammars/src/tree-sitter/injections.tsq",
			import.meta.url,
		),
		"utf8",
	);

	assert_equals(tree_sitter.highlights_query, normalize_line_endings(highlights_query));
	assert_equals(tree_sitter.injections_query, normalize_line_endings(injections_query));
});

test("TextMate grammar covers SER syntax examples", () => {
	const serialized = JSON.stringify(textmate_language);

	assert_string_includes(serialized, "storage.modifier.effect.ser.svelte");
	assert_string_includes(serialized, "keyword.control.yield.ser.svelte");
	assert_string_includes(serialized, "meta.embedded.declaration.ser.svelte");
	assert_string_includes(serialized, "meta.embedded.directive.block.ser.svelte");
	assert_string_includes(serialized, "meta.embedded.attribute.event.ser.svelte");
	assert_string_includes(serialized, "source.ts");
});

test("Tree-sitter queries describe SER highlighting and injection points", () => {
	assert_equals(tree_sitter.name, "svelte-effect-runtime");
	assert_string_includes(tree_sitter.highlights_query, "effect");
	assert_string_includes(tree_sitter.highlights_query, "yield_expression");
	assert_string_includes(tree_sitter.injections_query, "script_element");
	assert_string_includes(tree_sitter.injections_query, "yield\\\\s*\\\\*");
	assert_string_includes(tree_sitter.injections_query, "typescript");
});

test("tree-sitter query codegen keeps template breakout fixtures inert", async () => {
	const breakout_key = "__ser_tree_sitter_query_codegen_breakout";
	const highlights_query = [
		"; fixture with backslash-backtick: \\`",
		`; fixture with apostrophe and quote: it's "still data"`,
		'; fixture with interpolation: ${globalThis.__ser_tree_sitter_query_codegen_breakout = "executed"}',
	].join("\n");
	const injections_query = [
		"; second fixture with backslash-backtick: \\`",
		`; second fixture with apostrophe and quote: it's "still data"`,
		'; second fixture with interpolation: ${globalThis.__ser_tree_sitter_query_codegen_breakout = "executed-again"}',
	].join("\n");
	const code = generate_tree_sitter_query_module(highlights_query, injections_query);
	const module_url = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;

	Reflect.deleteProperty(globalThis, breakout_key);

	const generated_module = await import(module_url);

	assert_equals(generated_module.highlights_query, highlights_query);
	assert_equals(generated_module.injections_query, injections_query);
	assert_equals(Reflect.get(globalThis, breakout_key), undefined);
	assert_truthy(!code.includes("String.raw"));
});

test("TextMate grammar is applied by Shiki to SER syntax", async () => {
	const highlighter = await createHighlighter({
		themes: ["dark-plus"],
		langs: ["svelte", textmate_language],
	});

	const source = [
		`<script lang="ts" effect>`,
		`  import { GetUser } from "user.ts";`,
		`</script>`,
		``,
		`<p>side effect text</p>`,
		``,
		`<ScrollArea>`,
		`  {const currency = $derived((yield* GetUser()).preferredCurrency)}`,
		``,
		`  {#each yield* GetAllStocks() as stock}`,
		`    {const liveQuery = yield* GetLivePrice(stock.ticker)}`,
		`  {/each}`,
		`</ScrollArea>`,
	].join("\n");

	const result = await highlighter.codeToTokens(source, {
		lang: "svelte",
		theme: "dark-plus",
		includeExplanation: true,
	});

	const scopes = result.tokens
		.flat()
		.flatMap(
			(token) =>
				token.explanation?.flatMap((part) => part.scopes.map((scope) => scope.scopeName)) ??
				[],
		);
	const tokens = result.tokens.flat();
	const scope_names = (token: (typeof tokens)[number]) =>
		token.explanation?.flatMap((part) => part.scopes.map((scope) => scope.scopeName)) ?? [];
	const import_token = tokens.find((token) => token.content === "import");
	const text_token = tokens.find((token) => token.content === "side effect text");

	assert_truthy(scopes.includes("storage.modifier.effect.ser.svelte"));
	assert_truthy(scopes.includes("meta.embedded.declaration.ser.svelte"));
	assert_truthy(scopes.includes("meta.embedded.directive.block.ser.svelte"));
	assert_truthy(scopes.includes("keyword.control.yield.ser.svelte"));
	assert_truthy(import_token);
	assert_truthy(scope_names(import_token).includes("keyword.control.import.ts"));
	assert_truthy(text_token);
	assert_truthy(!scope_names(text_token).includes("storage.modifier.effect.ser.svelte"));

	highlighter.dispose();
});

function normalize_line_endings(value: string) {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
