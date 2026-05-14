import { copy } from "@std/fs/copy";
import { build } from "rolldown";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const package_dir = fromFileUrl(
  new URL(
    "../modules/svelte-effect-runtime-vscode-extension/",
    import.meta.url,
  ),
);
const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const output_dir = join(
  repo_root,
  ".dist",
  "svelte-effect-runtime-vscode-extension",
);
const package_dist = join(package_dir, ".dist");
const package_runtime_dir = join(package_dir, "runtime");
const output_runtime_dir = join(output_dir, "runtime");

await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
await Deno.mkdir(output_dir, { recursive: true });
await Deno.remove(package_dist, { recursive: true }).catch(() => undefined);

await build({
  input: {
    extension: join(package_dir, "src", "extension.ts"),
    server: join(package_dir, "src", "server.ts"),
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
    /^magic-string$/,
    /^@jridgewell\/trace-mapping$/,
    /^svelte-language-server$/,
  ],
});

await copy(package_runtime_dir, output_runtime_dir, { overwrite: true });
await copy(output_dir, package_dist, { overwrite: true });
