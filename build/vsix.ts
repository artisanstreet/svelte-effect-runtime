import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { Effect, pipe } from "effect";
import { copy } from "@std/fs/copy";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const package_dir = join(
  repo_root,
  "modules",
  "svelte-effect-runtime-vsix",
);
const output_dir = join(
  repo_root,
  ".dist",
  "svelte-effect-runtime-vsix",
);
const required_runtime_dependencies = [
  "vscode-languageclient",
];

const extension_files = [
  "extension.js",
  "extension.js.map",
] as const;

type VsixContext = {
  staging_dir: string;
  staging_dist_dir: string;
};

const clean_staging = (context: VsixContext) =>
  Effect.promise(() =>
    Deno.remove(context.staging_dir, { recursive: true }).catch(() => undefined)
  );

const staging_context = Effect.acquireRelease(
  Effect.tryPromise(async (): Promise<VsixContext> => {
    const staging_dir = await Deno.makeTempDir({
      prefix: "svelte-effect-runtime-vsix-",
    });

    return {
      staging_dir,
      staging_dist_dir: join(staging_dir, ".dist"),
    };
  }),
  clean_staging,
);

function prepare_staging(context: VsixContext) {
  return Effect.tryPromise(() =>
    Deno.mkdir(context.staging_dist_dir, { recursive: true })
  );
}

function copy_extension_output(context: VsixContext) {
  return Effect.tryPromise(async () => {
    await copy(
      join(output_dir, "chunks"),
      join(context.staging_dist_dir, "chunks"),
      {
        overwrite: true,
      },
    ).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    });

    for (const filename of extension_files) {
      await Deno.copyFile(
        join(output_dir, filename),
        join(context.staging_dist_dir, filename),
      )
        .catch((error) => {
          if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
          }
        });
    }

    await Deno.copyFile(
      join(package_dir, "README.md"),
      join(context.staging_dir, "README.md"),
    );
  });
}

function write_manifest(context: VsixContext) {
  return Effect.tryPromise(async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(package_dir, "package.json")),
    );

    await Deno.writeTextFile(
      join(context.staging_dir, "package.json"),
      `${JSON.stringify(include_packaged_node_modules(manifest), null, 2)}\n`,
    );

    return manifest;
  });
}

function install_dependencies(context: VsixContext) {
  return run_command(context, "npm", [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-package-lock",
    "--no-audit",
    "--no-fund",
  ]);
}

function assert_packaged_dependencies(context: VsixContext) {
  return Effect.tryPromise(() =>
    assert_runtime_dependencies_installed(
      context.staging_dir,
      required_runtime_dependencies,
    )
  );
}

function package_extension(
  context: VsixContext,
  manifest: Record<string, unknown>,
) {
  return Effect.gen(function* () {
    const output_name = `${manifest.name}-${manifest.version}.vsix`;

    yield* Effect.tryPromise(async () => {
      await Deno.mkdir(output_dir, { recursive: true });
      await Deno.remove(join(output_dir, output_name), { recursive: true })
        .catch(() => undefined);
    });

    yield* run_command(context, "npx", [
      "--yes",
      "@vscode/vsce@3.7.1",
      "package",
      "--allow-missing-repository",
      "--out",
      join(output_dir, output_name),
    ]);
  });
}

function run_command(
  context: VsixContext,
  command: string,
  args: string[],
) {
  return Effect.tryPromise(async () => {
    const result = await new Deno.Command(command, {
      args,
      cwd: context.staging_dir,
      stdout: "inherit",
      stderr: "inherit",
    }).output();

    if (result.code !== 0) {
      throw new Error(`${command} ${args.join(" ")} failed.`);
    }
  });
}

function include_packaged_node_modules(manifest: Record<string, unknown>) {
  const files = Array.isArray(manifest.files)
    ? manifest.files.filter((value): value is string =>
      typeof value === "string"
    )
    : [];

  if (!files.includes("node_modules")) {
    files.push("node_modules");
  }

  return {
    ...manifest,
    files,
  };
}

async function assert_runtime_dependencies_installed(
  root: string,
  dependencies: string[],
) {
  for (const dependency of dependencies) {
    await Deno.stat(join(root, "node_modules", dependency, "package.json"));
  }
}

const program = pipe(
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* staging_context;

      yield* prepare_staging(context);
      yield* copy_extension_output(context);

      const manifest = yield* write_manifest(context);

      yield* install_dependencies(context);
      yield* assert_packaged_dependencies(context);
      yield* package_extension(context, manifest);
    }),
  ),
);

NodeRuntime.runMain(program);
