import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { Effect, pipe } from "effect";
import { copy } from "@std/fs/copy";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

const target = Deno.args[0];

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

const optional_runtime_files = [
  "preprocess.js",
  "mod.js",
  "generators.js",
  "dispatcher.js",
  "detect.js",
] as const;
const runtime_directories = [
  "chunks",
  "internal",
  "markup",
  "remote",
  "runtime",
];

const validate_target = Effect.sync(() => {
  if (!target) {
    throw new Error("Expected target package name.");
  }
});

const assert_runtime_dist = Effect.tryPromise(async () => {
  try {
    await Deno.stat(runtime_dist);
  } catch {
    throw new Error(`Runtime .dist not found at ${runtime_dist}`);
  }
});

const prepare_output = Effect.tryPromise(async () => {
  await Deno.mkdir(target_dist_dir, { recursive: true });
  await Deno.remove(package_runtime_dir, { recursive: true }).catch(() =>
    undefined
  );
  await Deno.remove(runtime_dir, { recursive: true }).catch(() => undefined);
  await Deno.mkdir(runtime_dir, { recursive: true });
});

const write_runtime_manifest = Effect.tryPromise(async () => {
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
});

const copy_optional_runtime_files = Effect.tryPromise(async () => {
  for (const filename of optional_runtime_files) {
    try {
      await Deno.copyFile(
        join(runtime_dist, filename),
        join(runtime_dir, filename),
      );
    } catch {
      /** Optional compatibility output. */
    }
  }
});

const copy_runtime_directories = Effect.tryPromise(async () => {
  for (const directory of runtime_directories) {
    const source_dir = join(runtime_dist, directory);
    const target_dir = join(runtime_dir, directory);

    try {
      await Deno.stat(source_dir);
      await Deno.mkdir(target_dir, { recursive: true });
      await copy(source_dir, target_dir, { overwrite: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
});

const write_transform_shims = Effect.tryPromise(async () => {
  await Deno.writeTextFile(
    join(runtime_dir, "transform.js"),
    `export * from "./runtime/transform.js";\n`,
  );
  await Deno.writeTextFile(
    join(runtime_dir, "transform.d.ts"),
    `export * from "./runtime/transform";\n`,
  );
});

const copy_package_runtime = Effect.tryPromise(() =>
  copy(runtime_dir, package_runtime_dir, { overwrite: true })
);

const program = pipe(
  Effect.gen(function* () {
    yield* validate_target;
    yield* assert_runtime_dist;
    yield* prepare_output;
    yield* write_runtime_manifest;
    yield* copy_optional_runtime_files;
    yield* copy_runtime_directories;
    yield* write_transform_shims;
    yield* copy_package_runtime;
  }),
);

NodeRuntime.runMain(program);
