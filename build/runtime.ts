import { copy } from "@std/fs/copy";
import { build } from "rolldown";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const package_dir = fromFileUrl(
  new URL("../modules/svelte-effect-runtime/", import.meta.url),
);
const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime");
const package_dist = join(package_dir, ".dist");

await Deno.mkdir(output_dir, { recursive: true });
await Deno.remove(package_dist, { recursive: true }).catch(() => undefined);
await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
await Deno.mkdir(output_dir, { recursive: true });

const external = [
  /^node:/,
  /^\$app\/server$/,
  /^@sveltejs\/kit(?:\/.*)?$/,
  /^@sveltejs\/kit\/internal\/server$/,
  /^effect(?:\/.*)?$/,
  /^svelte(?:\/.*)?$/,
  /^vite$/,
  /^@sveltejs\/vite-plugin-svelte$/,
  /^typescript$/,
];

await build({
  input: {
    mod: join(package_dir, "mod.ts"),
    "root-node": join(package_dir, "root-node.ts"),
    "v4/mod": join(package_dir, "v4", "mod.ts"),
    "v4/root-node": join(package_dir, "v4", "root-node.ts"),
    "v4/effect": join(package_dir, "v4", "effect.ts"),
    "v4/preprocess": join(package_dir, "v4", "preprocess.ts"),
    "v4/server": join(package_dir, "v4", "server.ts"),
    "v4/vite": join(package_dir, "v4", "vite.ts"),
    effect: join(package_dir, "effect.ts"),
    client: join(package_dir, "client.ts"),
    server: join(package_dir, "server.ts"),
    preprocess: join(package_dir, "preprocess.ts"),
    vite: join(package_dir, "vite.ts"),
    "language-server": join(package_dir, "language-server.ts"),
    "internal/markup": join(package_dir, "internal", "markup.ts"),
    "internal/remote-client": join(package_dir, "internal", "remote-client.ts"),
    "internal/remote-shared": join(package_dir, "internal", "remote-shared.ts"),
    "internal/transform": join(package_dir, "internal", "transform.ts"),
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
      name: "runtime-root-aliases",
      resolveId(source) {
        if (source === "$") {
          return join(package_dir, "mod.ts");
        }

        if (source.startsWith("$/")) {
          return join(package_dir, source.slice(2));
        }

        if (source.startsWith("$internal/")) {
          return join(package_dir, "internal", source.slice("$internal/".length));
        }

        if (source.startsWith("$tests/")) {
          return join(package_dir, "tests", source.slice("$tests/".length));
        }

        return null;
      },
    },
  ],
  external,
});

await copy(output_dir, package_dist, { overwrite: true });
