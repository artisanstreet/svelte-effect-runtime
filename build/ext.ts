import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { Effect, pipe } from "effect";
import { copy } from "@std/fs/copy";
import { build } from "rolldown";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

const package_dir = fromFileUrl(
  new URL(
    "../modules/svelte-effect-runtime-vsix/",
    import.meta.url,
  ),
);
const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const output_dir = join(
  repo_root,
  ".dist",
  "svelte-effect-runtime-vsix",
);
const package_dist = join(package_dir, ".dist");

const prepare_output = Effect.tryPromise(async () => {
  await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
  await Deno.mkdir(output_dir, { recursive: true });
  await Deno.remove(package_dist, { recursive: true }).catch(() => undefined);
});

const bundle_extension = Effect.tryPromise(() =>
  build({
    input: {
      extension: join(package_dir, "src", "extension.ts"),
    },
    output: {
      dir: output_dir,
      format: "esm",
      entryFileNames: "[name].js",
      chunkFileNames: "chunks/[name]-[hash].js",
      sourcemap: true,
    },
    external: [
      /^node:/,
      /^vscode$/,
      /^vscode-languageclient(\/.*)?$/,
      /^magic-string$/,
      /^@jridgewell\/trace-mapping$/,
      /^svelte-language-server$/,
      /^vscode-languageserver(\/.*)?$/,
    ],
  })
);

const copy_dist = Effect.tryPromise(() =>
  copy(output_dir, package_dist, { overwrite: true })
);

const program = pipe(
  Effect.gen(function* () {
    yield* prepare_output;
    yield* bundle_extension;
    yield* copy_dist;
  }),
);

NodeRuntime.runMain(program);
