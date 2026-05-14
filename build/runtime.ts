import { copy } from "@std/fs/copy";
import { build } from "rolldown";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const package_dir = fromFileUrl(
  new URL("../modules/svelte-effect-runtime/", import.meta.url),
);
const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime");
const package_dist = join(package_dir, ".dist");
const src_dir = join(package_dir, "src");

await Deno.mkdir(output_dir, { recursive: true });
await Deno.remove(package_dist, { recursive: true }).catch(() => undefined);
await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
await Deno.mkdir(output_dir, { recursive: true });

const external = [
  /^node:/,
  /^effect(?:\/.*)?$/,
  /^svelte(?:\/.*)?$/,
  /^vite$/,
  /^@sveltejs\/vite-plugin-svelte$/,
  /^@sveltejs\/kit(?:\/.*)?$/,
  /^typescript$/,
  /^magic-string$/,
  /^devalue$/,
  /^@babel\/parser$/,
];

await build({
  input: {
    mod: join(src_dir, "mod.ts"),
    detect: join(src_dir, "detect.ts"),
    dispatcher: join(src_dir, "dispatcher.ts"),
    generators: join(src_dir, "generators.ts"),
    lowering: join(src_dir, "lowering.ts"),
    preprocess: join(src_dir, "preprocess.ts"),
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
      name: "runtime-aliases",
      resolveId(source) {
        if (source === "$") return join(src_dir, "mod.ts");
        if (source.startsWith("$/")) return join(src_dir, source.slice(2));
        return null;
      },
    },
  ],
  external,
});

await copy(output_dir, package_dist, { overwrite: true });
