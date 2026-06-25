import {
  transform_markup_effect,
  transform_script_effect,
} from "../../../modules/svelte-effect-runtime/src/runtime/preprocess.ts";
import { prepare_virtual_document } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/virtual-document.ts";
import { normalize_transform_result } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/transform-results.ts";
import { create_safe_preprocess } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/safe-preprocess.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

type TestDocument = {
  uri: string;
  version: number;
  openedByClient: boolean;
  config: undefined;
  configPromise: undefined;
  getText(): string;
  getFilePath(): string;
};

function make_document(content: string): TestDocument {
  const filename = "/src/routes/(application)/search/+page.svelte";

  return {
    uri: "file:///src/routes/(application)/search/+page.svelte",
    version: 1,
    openedByClient: true,
    config: undefined,
    configPromise: undefined,
    getText: () => content,
    getFilePath: () => filename,
  };
}

Deno.test("language server virtual document recovers from script transform errors", () => {
  const source = [
    `<script lang="ts" effect>`,
    `  const query = "abc";`,
    `  const result = $derived.by(() => {`,
    `    if (!query) return [];`,
    `    yield* searchRemote({ query, limit: 10 });`,
    `  });`,
    `</script>`,
  ].join("\n");

  const result = prepare_virtual_document(make_document(source), {
    transformEffectMarkup: (code, options) =>
      normalize_transform_result(
        transform_markup_effect(code, options.filename),
        code,
        options.filename,
      ),
    transformEffectScript: (code, options) =>
      normalize_transform_result(
        transform_script_effect(code, options.filename),
        code,
        options.filename,
      ),
  });

  assert(result);
  assertStringIncludes(
    result.document.getText(),
    "__SER_language_server_transform_error",
  );
  assertStringIncludes(
    result.document.getText(),
    "yield* cannot be used inside $derived.by()",
  );
});

Deno.test("language server preprocess recovers from runtime preprocess errors", async () => {
  const source = `<script lang="ts" effect>yield* broken();</script>`;
  const create_preprocess = create_safe_preprocess(() => ({
    name: "svelte-effect-runtime",
    markup() {
      throw new Error("runtime transform failed");
    },
  }));

  const group = create_preprocess();
  const result = await group.markup({
    content: source,
    filename: "Broken.svelte",
  });

  assertEquals(result.code, source);
});
