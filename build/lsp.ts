import { copy } from "@std/fs/copy";
import { build } from "rolldown";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

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

await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
await Deno.mkdir(output_dir, { recursive: true });
await Deno.remove(package_dist, { recursive: true }).catch(() => undefined);

await build({
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
});

await copy(output_dir, package_dist, { overwrite: true });
