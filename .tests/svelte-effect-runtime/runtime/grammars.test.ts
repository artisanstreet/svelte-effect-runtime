import {
  TextMate,
  textmate,
  textmate_language,
  tree_sitter,
  TreesitterQuery,
} from "../../../modules/svelte-effect-runtime/src/grammars.ts";
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
