import { copy } from "@std/fs/copy";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const target = Deno.args[0];

if (!target) throw new Error("Expected target package name.");

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const runtime_dist = join(repo_root, ".dist", "svelte-effect-runtime");
const runtime_manifest_path = join(
  repo_root,
  "modules",
  "svelte-effect-runtime",
  "package.json",
);
const package_dir = join(repo_root, "modules", target);
const target_dist_dir = join(repo_root, ".dist", target);
const runtime_dir = join(target_dist_dir, "runtime");
const package_runtime_dir = join(package_dir, "runtime");

try {
  await Deno.stat(runtime_dist);
} catch {
  throw new Error(`Runtime .dist not found at ${runtime_dist}`);
}

await Deno.mkdir(target_dist_dir, { recursive: true });
await Deno.remove(package_runtime_dir, { recursive: true }).catch(() =>
  undefined
);
await Deno.remove(runtime_dir, { recursive: true }).catch(() => undefined);
await Deno.mkdir(runtime_dir, { recursive: true });

const runtime_manifest = JSON.parse(
  await Deno.readTextFile(runtime_manifest_path),
);
const runtime_package_json = {
  type: "module",
  dependencies: {
    svelte: runtime_manifest.peerDependencies?.svelte,
    typescript: runtime_manifest.dependencies?.typescript,
  },
};

await Deno.writeTextFile(
  join(runtime_dir, "package.json"),
  `${JSON.stringify(runtime_package_json, null, 2)}\n`,
);

for (
  const filename of [
    "preprocess.js",
    "mod.js",
    "generators.js",
    "dispatcher.js",
    "detect.js",
  ]
) {
  try {
    await Deno.copyFile(
      join(runtime_dist, filename),
      join(runtime_dir, filename),
    );
  } catch {
    /** Optional compatibility output. */
  }
}

for (const dirname of ["chunks", "internal", "markup", "remote", "runtime"]) {
  const source_dir = join(runtime_dist, dirname);
  const target_dir = join(runtime_dir, dirname);

  try {
    await Deno.stat(source_dir);
    await Deno.mkdir(target_dir, { recursive: true });
    await copy(source_dir, target_dir, { overwrite: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

await Deno.writeTextFile(
  join(runtime_dir, "transform.js"),
  `export * from "./runtime/transform.js";\n`,
);
await Deno.writeTextFile(
  join(runtime_dir, "transform.d.ts"),
  `export * from "./runtime/transform";\n`,
);

await copy(runtime_dir, package_runtime_dir, { overwrite: true });
