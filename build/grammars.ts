import { generate_tree_sitter_query_module } from "./grammar-query-codegen.ts";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { copy } from "@std/fs/copy";
import { Effect, pipe } from "effect";
import { build } from "rolldown";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

const package_dir = fromFileUrl(
  new URL("../modules/svelte-effect-runtime-grammars/", import.meta.url),
);
const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime-grammars");
const src_dir = join(package_dir, "src");
const highlights_query_path = join(src_dir, "tree-sitter", "highlights.tsq");
const injections_query_path = join(src_dir, "tree-sitter", "injections.tsq");
const generated_query_module_path = join(
  src_dir,
  "tree-sitter",
  "queries.generated.ts",
);

const prepare_output = Effect.tryPromise(async () => {
  await Deno.mkdir(output_dir, { recursive: true });
  await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
  await Deno.mkdir(output_dir, { recursive: true });
});

const write_tree_sitter_query_module = Effect.tryPromise(async () => {
  const highlights_query = normalize_line_endings(
    await Deno.readTextFile(highlights_query_path),
  );
  const injections_query = normalize_line_endings(
    await Deno.readTextFile(injections_query_path),
  );

  await Deno.writeTextFile(
    generated_query_module_path,
    generate_tree_sitter_query_module(highlights_query, injections_query),
  );
});

const bundle_grammars = Effect.tryPromise(() =>
  build({
    input: {
      mod: join(src_dir, "mod.ts"),
      textmate: join(src_dir, "textmate.ts"),
      "tree-sitter": join(src_dir, "tree-sitter.ts"),
    },
    output: {
      dir: output_dir,
      format: "esm",
      entryFileNames: "[name].js",
      chunkFileNames: "chunks/[name]-[hash].js",
      sourcemap: true,
    },
    plugins: [
      {
        name: "grammar-text-assets",
        async load(id) {
          if (!id.endsWith(".tsq")) {
            return null;
          }

          const content = await Deno.readTextFile(id);

          return {
            code: `export default ${JSON.stringify(content)};`,
            moduleType: "js",
          };
        },
      },
    ],
  })
);

const copy_assets = Effect.tryPromise(async () => {
  await copy(join(src_dir, "textmate"), join(output_dir, "textmate"), {
    overwrite: true,
  });
  await copy(join(src_dir, "tree-sitter"), join(output_dir, "tree-sitter"), {
    overwrite: true,
  });
});

const program = pipe(
  Effect.gen(function* () {
    yield* prepare_output;
    yield* write_tree_sitter_query_module;
    yield* bundle_grammars;
    yield* copy_assets;
  }),
);

NodeRuntime.runMain(program);

function normalize_line_endings(value: string) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
