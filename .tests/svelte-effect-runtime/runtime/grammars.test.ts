import {
  TextMate,
  textmate,
  textmate_language,
  tree_sitter,
  TreesitterQuery,
} from "svelte-effect-runtime-grammars";
import { generate_tree_sitter_query_module } from "../../../build/grammar-query-codegen.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createHighlighter } from "shiki";

Deno.test("exports a Shiki-ready TextMate injection grammar for Svelte", () => {
  assertEquals(TextMate, textmate);
  assertEquals(TreesitterQuery, tree_sitter);
  assertEquals(textmate.language, textmate_language);
  assertEquals(textmate.scope_name, "source.svelte.ser.injection");
  assertEquals(textmate.target_scope_name, "source.svelte");
  assertEquals(textmate_language.injectTo, ["source.svelte"]);
  assertEquals(textmate_language.embeddedLangs, ["typescript"]);
  assertEquals(
    textmate_language.injectionSelector,
    "L:source.svelte -comment -string",
  );
});

Deno.test("grammar package loads tree-sitter queries from source assets", async () => {
  const highlights_query = await Deno.readTextFile(
    "../../modules/svelte-effect-runtime-grammars/src/tree-sitter/highlights.tsq",
  );
  const injections_query = await Deno.readTextFile(
    "../../modules/svelte-effect-runtime-grammars/src/tree-sitter/injections.tsq",
  );

  assertEquals(
    tree_sitter.highlights_query,
    normalize_line_endings(highlights_query),
  );
  assertEquals(
    tree_sitter.injections_query,
    normalize_line_endings(injections_query),
  );
});

Deno.test("TextMate grammar covers SER syntax examples", () => {
  const serialized = JSON.stringify(textmate_language);

  assertStringIncludes(serialized, "storage.modifier.effect.ser.svelte");
  assertStringIncludes(serialized, "keyword.control.yield.ser.svelte");
  assertStringIncludes(serialized, "meta.embedded.declaration.ser.svelte");
  assertStringIncludes(serialized, "meta.embedded.directive.block.ser.svelte");
  assertStringIncludes(serialized, "meta.embedded.attribute.event.ser.svelte");
  assertStringIncludes(serialized, "source.ts");
});

Deno.test("Tree-sitter queries describe SER highlighting and injection points", () => {
  assertEquals(tree_sitter.name, "svelte-effect-runtime");
  assertStringIncludes(tree_sitter.highlights_query, "effect");
  assertStringIncludes(tree_sitter.highlights_query, "yield_expression");
  assertStringIncludes(tree_sitter.injections_query, "script_element");
  assertStringIncludes(tree_sitter.injections_query, "yield\\\\s*\\\\*");
  assertStringIncludes(tree_sitter.injections_query, "typescript");
});

Deno.test("tree-sitter query codegen keeps template breakout fixtures inert", async () => {
  const breakout_key = "__ser_tree_sitter_query_codegen_breakout";
  const highlights_query = [
    "; fixture with backslash-backtick: \\`",
    '; fixture with interpolation: ${globalThis.__ser_tree_sitter_query_codegen_breakout = "executed"}',
  ].join("\n");
  const injections_query = [
    "; second fixture with backslash-backtick: \\`",
    '; second fixture with interpolation: ${globalThis.__ser_tree_sitter_query_codegen_breakout = "executed-again"}',
  ].join("\n");
  const code = generate_tree_sitter_query_module(
    highlights_query,
    injections_query,
  );
  const module_url = `data:text/javascript;charset=utf-8,${
    encodeURIComponent(code)
  }`;

  Reflect.deleteProperty(globalThis, breakout_key);

  const generated_module = await import(module_url);

  assertEquals(generated_module.highlights_query, highlights_query);
  assertEquals(generated_module.injections_query, injections_query);
  assertEquals(Reflect.get(globalThis, breakout_key), undefined);
  assert(!code.includes("String.raw"));
});

Deno.test("TextMate grammar is applied by Shiki to SER syntax", async () => {
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

  const scopes = result.tokens.flat().flatMap((token) =>
    token.explanation?.flatMap((part) =>
      part.scopes.map((scope) => scope.scopeName)
    ) ?? []
  );
  const tokens = result.tokens.flat();
  const scope_names = (token: typeof tokens[number]) =>
    token.explanation?.flatMap((part) =>
      part.scopes.map((scope) => scope.scopeName)
    ) ?? [];
  const import_token = tokens.find((token) => token.content === "import");
  const text_token = tokens.find((token) =>
    token.content === "side effect text"
  );

  assert(scopes.includes("storage.modifier.effect.ser.svelte"));
  assert(scopes.includes("meta.embedded.declaration.ser.svelte"));
  assert(scopes.includes("meta.embedded.directive.block.ser.svelte"));
  assert(scopes.includes("keyword.control.yield.ser.svelte"));
  assert(import_token);
  assert(scope_names(import_token).includes("keyword.control.import.ts"));
  assert(text_token);
  assert(
    !scope_names(text_token).includes("storage.modifier.effect.ser.svelte"),
  );

  highlighter.dispose();
});

function normalize_line_endings(value: string) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
