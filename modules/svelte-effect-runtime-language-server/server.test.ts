import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assert,
  assertEquals as assert_equals,
  assertMatch as assert_match,
  assertNotMatch as assert_not_match,
} from "@std/assert";
import { bootstrap_language_server } from "./server.ts";

const require = createRequire(import.meta.url);
const module_dir = path.dirname(fileURLToPath(import.meta.url));
const language_server_root = path.join(
  path.dirname(require.resolve("svelte-language-server/package.json")),
  "dist",
  "src",
);
const { DocumentManager, Document } = require(path.join(
  language_server_root,
  "lib",
  "documents",
));
const { DocumentSnapshot } = require(path.join(
  language_server_root,
  "plugins",
  "typescript",
  "DocumentSnapshot.js",
));
const { SvelteDocument } = require(path.join(
  language_server_root,
  "plugins",
  "svelte",
  "SvelteDocument.js",
));
const { LSConfigManager } = require(path.join(
  language_server_root,
  "ls-config.js",
));
const { LSAndTSDocResolver } = require(path.join(
  language_server_root,
  "plugins",
  "typescript",
  "LSAndTSDocResolver.js",
));
const { HoverProviderImpl } = require(path.join(
  language_server_root,
  "plugins",
  "typescript",
  "features",
  "HoverProvider.js",
));

await bootstrap_language_server();

async function load_compiler() {
  const module = await import(
    pathToFileURL(require.resolve("svelte/compiler")).href,
  );

  return module.default ?? module["module.exports"] ?? module;
}

async function create_transform_options() {
  const compiler = await load_compiler();
  return {
    parse: compiler.parse,
    version: compiler.VERSION,
    transformOnTemplateError: false,
    typingsNamespace: "svelteHTML",
  };
}

async function create_checkout_fixture() {
  const fixtures_root = path.join(module_dir, ".tmp");
  await Deno.mkdir(fixtures_root, { recursive: true });
  const fixture_dir = await Deno.makeTempDir({
    dir: fixtures_root,
    prefix: "checkout-hover-",
  });
  const routes_dir = path.join(fixture_dir, "src", "routes", "checkout");
  await Deno.mkdir(routes_dir, { recursive: true });

  await Deno.writeTextFile(
    path.join(fixture_dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "bundler",
        target: "ES2022",
        strict: true,
        allowJs: true,
        checkJs: true,
        skipLibCheck: true,
        types: ["svelte"],
      },
      include: ["src/**/*.ts", "src/**/*.svelte"],
    }, null, 2),
  );
  await Deno.writeTextFile(
    path.join(fixture_dir, "package.json"),
    JSON.stringify({
      type: "module",
    }, null, 2),
  );
  await Deno.writeTextFile(
    path.join(fixture_dir, "svelte.config.js"),
    `export default {
  compilerOptions: {
    runes: true,
    experimental: {
      async: true,
    },
  },
};\n`,
  );
  await Deno.writeTextFile(
    path.join(routes_dir, "errors.ts"),
    `import { Data } from "effect";

export class OutOfStock extends Data.TaggedError("OutOfStock")<{
  readonly sku: string;
}> {}

export class PaymentDeclined extends Data.TaggedError("PaymentDeclined")<{
  readonly reason: "fraud_suspected";
}> {}
`,
  );
  await Deno.writeTextFile(
    path.join(routes_dir, "checkout.remote.ts"),
    `import { Effect, Schema } from "effect";
import { OutOfStock, PaymentDeclined } from "./errors";

export const Order = Schema.Struct({
  sku: Schema.String,
  quantity: Schema.Number,
});

export type Order = typeof Order.Type;

export const place_order = ({ sku, quantity }: Order) =>
  Effect.gen(function* () {
    if (sku === "mug-01") {
      yield* Effect.fail(new OutOfStock({ sku }));
    }

    if (quantity >= 3) {
      yield* Effect.fail(new PaymentDeclined({ reason: "fraud_suspected" }));
    }

    return {
      sku,
      quantity,
      confirmation: "ord_demo",
    };
  });
`,
  );
  await Deno.writeTextFile(
    path.join(routes_dir, "+page.svelte"),
    `<script lang="ts" effect>
  import { Effect } from "effect";
  import { place_order } from "./checkout.remote";

  const request = { sku: "book-42", quantity: 3 } as const;

  const result = yield* place_order(request).pipe(
    Effect.catchTags({
      OutOfStock: (error) =>
        Effect.succeed({
          kind: "error" as const,
          message: error.sku,
        }),
      PaymentDeclined: (error) =>
        Effect.succeed({
          kind: "error" as const,
          message: error.reason,
        }),
    }),
    Effect.map((value) =>
      "confirmation" in value
        ? {
            kind: "ok" as const,
            message: value.confirmation,
          }
        : value
    ),
  );
</script>

{#if !result}
  <p>Loading</p>
{:else if result.kind === "ok"}
  <p>{result.message}</p>
{:else}
  <p>{result.message}</p>
{/if}
`,
  );

  return fixture_dir;
}

async function get_hover_text(
  fixture_dir: string,
  needle: string,
  offset_adjustment = 0,
) {
  type TextDocumentLike = {
    uri: string;
    text: string;
  };

  const compiler = await load_compiler();
  const file_path = path.join(fixture_dir, "src", "routes", "checkout", "+page.svelte");
  const source = await Deno.readTextFile(file_path);
  const doc_manager = new DocumentManager((textDocument: TextDocumentLike) =>
    new Document(textDocument.uri, textDocument.text)
  );
  const config_manager = new LSConfigManager();
  const fixture_uri = pathToFileURL(fixture_dir).href.replace(/\/$/, "");
  const resolver = new LSAndTSDocResolver(
    doc_manager,
    [fixture_uri],
    config_manager,
    {
      watch: false,
      tsSystem: require("typescript").sys,
      tsconfigPath: path.join(fixture_dir, "tsconfig.json"),
    },
  );
  const hover_provider = new HoverProviderImpl(resolver);
  const document = doc_manager.openDocument({
    uri: pathToFileURL(file_path).href,
    text: source,
  }, true);
  document.openedByClient = true;
  document._compiler = compiler;

  const hover = await hover_provider.doHover(
    document,
    document.positionAt(source.indexOf(needle) + offset_adjustment),
  );

  return hover?.contents ?? null;
}

Deno.test("builds a mappable TS snapshot from Effect syntax", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";

  let count = $state(2);
  const pokemon = Effect.tryPromise({
    try: async () => {
      const response = await fetch("https://pokeapi.co/api/v2/pokemon/1");
      return await response.json();
    },
    catch: (error) => error
  }).pipe(Effect.map((data) => data.name));

  const increment = Effect.gen(function* () {
    count = count * count;
  });
</script>

<button onclick={() => yield* increment}>Increment</button>
<p>{yield* pokemon}</p>
<p>{count}</p>`;

  const document = Document.createForTest(
    "file:///virtual/snapshot.svelte",
    source,
  );
  const options = await create_transform_options();
  const snapshot = DocumentSnapshot.fromDocument(document, options);

  assert_equals(snapshot.parserError, null);

  const count_offset = source.lastIndexOf("{count}") + 1;
  const count_position = document.positionAt(count_offset);
  const generated_count = snapshot.getGeneratedPosition(count_position);
  assert(generated_count.line >= 0);
  assert_equals(snapshot.getOriginalPosition(generated_count), count_position);

  const pokemon_offset = source.indexOf("pokemon}</p>");
  const node = snapshot.svelteNodeAt(pokemon_offset);
  assert(node);
  assert(node.start <= pokemon_offset);
  assert(node.end >= pokemon_offset);
});

Deno.test("lowered yield declarations still map to generated script symbols", async () => {
  const source = `<script lang="ts" effect>
  import { TestRemote } from "./test.remote";

  const test = yield* TestRemote({ name: "John", age: 20 });
</script>`;

  const document = Document.createForTest(
    "file:///virtual/lowered-binding.svelte",
    source,
  );
  const options = await create_transform_options();
  const snapshot = DocumentSnapshot.fromDocument(document, options);
  const test_offset = source.indexOf("test =") + 1;
  const test_position = document.positionAt(test_offset);
  const generated_test = snapshot.getGeneratedPosition(test_position);
  const generated_test_offset = snapshot.offsetAt(generated_test);
  const generated_test_window = snapshot.getFullText().slice(
    Math.max(0, generated_test_offset - 60),
    Math.min(snapshot.getFullText().length, generated_test_offset + 120),
  );
  const remote_offset = source.indexOf("TestRemote({");
  const remote_position = document.positionAt(remote_offset);
  const generated_remote = snapshot.getGeneratedPosition(remote_position);
  const generated_remote_offset = snapshot.offsetAt(generated_remote);
  const generated_remote_window = snapshot.getFullText().slice(
    Math.max(0, generated_remote_offset - 60),
    Math.min(snapshot.getFullText().length, generated_remote_offset + 120),
  );

  assert(generated_test.line >= 0);
  assert_match(
    generated_test_window,
    /let test: __svelteEffectRuntimeYielded<ReturnType<typeof __svelteEffectRuntime_test_\d+>> = \$state/,
  );
  assert(generated_remote.line >= 0);
  assert_match(generated_remote_window, /TestRemote\(\{ name: "John", age: 20 \}\)/);
});

Deno.test("destructured bindings map each name to its own generated symbol", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";

  const { first, second } = yield* Effect.succeed({ first: 1, second: 2 });
</script>`;

  const document = Document.createForTest(
    "file:///virtual/destructured-bindings.svelte",
    source,
  );
  const options = await create_transform_options();
  const snapshot = DocumentSnapshot.fromDocument(document, options);
  const second_offset = source.indexOf("second }") + 1;
  const second_position = document.positionAt(second_offset);
  const generated_second = snapshot.getGeneratedPosition(second_position);
  const generated_second_offset = snapshot.offsetAt(generated_second);
  const generated_second_window = snapshot.getFullText().slice(
    Math.max(0, generated_second_offset - 60),
    Math.min(snapshot.getFullText().length, generated_second_offset + 120),
  );
  const generated_second_token = snapshot.getFullText().slice(
    generated_second_offset,
    Math.min(snapshot.getFullText().length, generated_second_offset + 24),
  );

  assert(generated_second.line >= 0);
  assert_match(generated_second_window, /let second = \$state<any>\(undefined\);/);
  assert_match(generated_second_token, /^econd = \$state<any>\(/);
});

Deno.test("hover stays typed in script declarations and markup for checkout flows", async () => {
  const fixture_dir = await create_checkout_fixture();

  try {
    const place_order_hover = await get_hover_text(
      fixture_dir,
      "place_order",
    );
    const request_hover = await get_hover_text(
      fixture_dir,
      "const request",
      "const ".length,
    );
    const result_decl_hover = await get_hover_text(
      fixture_dir,
      "const result",
      "const ".length,
    );
    const markup_hover = await get_hover_text(
      fixture_dir,
      "!result",
      1,
    );
    const message_hover = await get_hover_text(
      fixture_dir,
      "result.message",
      2,
    );

    assert(typeof place_order_hover === "string");
    assert_match(
      place_order_hover as string,
      /OutOfStock \| PaymentDeclined/,
    );
    assert(typeof request_hover === "string");
    assert_match(
      request_hover as string,
      /readonly sku: "book-42"/,
    );
    assert(typeof result_decl_hover === "string");
    assert_match(
      result_decl_hover as string,
      /kind: "ok"/,
    );
    assert_not_match(
      result_decl_hover as string,
      /\| undefined/,
    );
    assert_not_match(result_decl_hover as string, /\bany\b/);
    assert(typeof markup_hover === "string");
    assert_match(
      markup_hover as string,
      /kind: "ok"/,
    );
    assert_not_match(
      markup_hover as string,
      /\| undefined/,
    );
    assert_not_match(markup_hover as string, /\bany\b/);
    assert(typeof message_hover === "string");
    assert_match(
      message_hover as string,
      /kind: "ok"/,
    );
    assert_not_match(message_hover as string, /\bundefined\b/);
  } finally {
    await Deno.remove(fixture_dir, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("snapshot mapping short-circuits invalid generated positions", async () => {
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const count = yield* Effect.succeed(42);
</script>

<p>{count}</p>`;

  const document = Document.createForTest(
    "file:///virtual/effect-attribute.svelte",
    source,
  );
  const options = await create_transform_options();
  const snapshot = DocumentSnapshot.fromDocument(document, options);
  const mapper = snapshot.getMapper() as {
    preprocessMapper: {
      mappers: Array<{
        getGeneratedPosition(position: { line: number; character: number }): {
          line: number;
          character: number;
        };
        getOriginalPosition(position: { line: number; character: number }): {
          line: number;
          character: number;
        };
        isInGenerated(position: { line: number; character: number }): boolean;
      }>;
      getGeneratedPosition(position: { line: number; character: number }): {
        line: number;
        character: number;
      };
    };
    innerMapper: {
      getGeneratedPosition(position: { line: number; character: number }): {
        line: number;
        character: number;
      };
    };
    getGeneratedPosition(position: { line: number; character: number }): {
      line: number;
      character: number;
    };
  };

  mapper.preprocessMapper.mappers = [
    {
      getGeneratedPosition() {
        throw new Error("Sequential mapper should stop after an invalid position.");
      },
      getOriginalPosition(position) {
        return position;
      },
      isInGenerated() {
        return true;
      },
    },
    {
      getGeneratedPosition() {
        return { line: -1, character: -1 };
      },
      getOriginalPosition(position) {
        return position;
      },
      isInGenerated() {
        return false;
      },
    },
  ];

  assert_equals(
    mapper.preprocessMapper.getGeneratedPosition({ line: 0, character: 0 }),
    { line: -1, character: -1 },
  );

  mapper.preprocessMapper = {
    ...mapper.preprocessMapper,
    getGeneratedPosition() {
      return { line: -1, character: -1 };
    },
  };
  mapper.innerMapper = {
    getGeneratedPosition() {
      throw new Error("Snapshot mapper should not call the inner mapper.");
    },
  };

  assert_equals(
    mapper.getGeneratedPosition({ line: 0, character: 0 }),
    { line: -1, character: -1 },
  );
});

Deno.test("injects the runtime preprocessor into the Svelte compiler path", async () => {
  const compiler = await load_compiler();
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const count = yield* Effect.succeed(42);
</script>

<p>{count}</p>`;

  const document = Document.createForTest(
    "file:///virtual/transpile.svelte",
    source,
  );
  document._compiler = compiler;

  const transpiled = await new SvelteDocument(document).getTranspiled();

  assert_match(transpiled.getText(), /run_component_effect/);
  assert_not_match(transpiled.getText(), /<script[^>]*effect/);
});

Deno.test("injects a TS fallback preprocessor when config has no preprocess", async () => {
  const compiler = await load_compiler();
  const source = `<script lang="ts" effect>
  import { Effect } from "effect";
  const count: number = yield* Effect.succeed(42);
</script>

<p>{count}</p>`;

  const document = Document.createForTest(
    "file:///virtual/no-preprocess-config.svelte",
    source,
  );
  document._compiler = compiler;
  document.configPromise = Promise.resolve({
    compilerOptions: {},
  });

  const transpiled = await new SvelteDocument(document).getTranspiled();
  const transpiled_text = transpiled.getText();
  const compiled = await new SvelteDocument(document).getCompiled();

  assert_match(transpiled_text, /run_component_effect/);
  assert_not_match(transpiled_text, /<script[^>]*effect/);
  assert_not_match(transpiled_text, /<script[^>]*lang=/);
  assert_not_match(transpiled_text, /const count: number/);
  assert_equals(compiled.warnings, []);
});
