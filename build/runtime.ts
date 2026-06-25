import { build } from "rolldown";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const package_dir = fromFileUrl(
  new URL("../modules/svelte-effect-runtime/", import.meta.url),
);
const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime");
const src_dir = join(package_dir, "src");

await Deno.mkdir(output_dir, { recursive: true });
await Deno.remove(output_dir, { recursive: true }).catch(() => undefined);
await Deno.mkdir(output_dir, { recursive: true });

const external = [
  /^node:/,
  /^effect(?:\/.*)?$/,
  /^svelte(?:\/.*)?$/,
  /^vite$/,
  /^@sveltejs\/vite-plugin-svelte$/,
  /^@sveltejs\/kit(?:\/.*)?$/,
  /^\$app\//,
  /^typescript$/,
  /^magic-string$/,
  /^devalue$/,
  /^@babel\/parser$/,
];

await build({
  input: {
    mod: join(src_dir, "mod.ts"),
    grammars: join(src_dir, "grammars.ts"),
    server: join(src_dir, "server.ts"),
    vite: join(src_dir, "vite.ts"),
    "runtime/preprocess": join(src_dir, "runtime", "preprocess.ts"),
    "internal/generators": join(src_dir, "internal", "generators.ts"),
    "internal/remote-client": join(src_dir, "internal", "remote-client.ts"),
    "internal/remote-server": join(src_dir, "internal", "remote-server.ts"),
    detect: join(src_dir, "detect.ts"),
    dispatcher: join(src_dir, "dispatcher.ts"),
    preprocess: join(src_dir, "preprocess.ts"),
    "remote/shared": join(src_dir, "remote", "shared.ts"),
    "remote/server": join(src_dir, "remote", "server.ts"),
    "remote/client": join(src_dir, "remote", "client.ts"),
    "markup/transform": join(src_dir, "markup", "transform.ts"),
    "markup/value": join(src_dir, "markup", "value.ts"),
    "markup/promise": join(src_dir, "markup", "promise.ts"),
    "markup/run": join(src_dir, "markup", "run.ts"),
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
