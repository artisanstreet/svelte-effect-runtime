import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { Effect, pipe } from "effect";
import { copy } from "@std/fs/copy";
import { build } from "rolldown";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

const package_dir = fromFileUrl(
  new URL(
    "../modules/svelte-effect-runtime-language-server/",
    import.meta.url,
  ),
);
const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const output_dir = join(
  repo_root,
  ".dist",
  "svelte-effect-runtime-language-server",
);
const package_dist = join(package_dir, ".dist");

const prepare_output = Effect.tryPromise(async () => {
  await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
  await Deno.mkdir(output_dir, { recursive: true });
  await Deno.remove(package_dist, { recursive: true }).catch(() => undefined);
});

const bundle_lsp = Effect.tryPromise(() =>
  build({
    input: join(package_dir, "src", "server.ts"),
    output: {
      file: join(output_dir, "server.cjs"),
      format: "cjs",
      sourcemap: true,
      banner: "#!/usr/bin/env node",
    },
    external: [
      /^node:/,
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
    yield* bundle_lsp;
    yield* copy_dist;
  }),
);

NodeRuntime.runMain(program);
