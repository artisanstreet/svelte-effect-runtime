import { copy } from "@std/fs/copy";
import { build } from "rolldown";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

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

await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
await Deno.mkdir(output_dir, { recursive: true });
await Deno.remove(package_dist, { recursive: true }).catch(() => undefined);

await build({
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
});

await copy(output_dir, package_dist, { overwrite: true });
