import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { Effect, pipe } from "effect";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

type CleanTarget = {
  paths: string[];
  files?: Array<{
    directory: string;
    extensions: string[];
  }>;
};

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const target_names = [
  "svelte-effect-runtime",
  "svelte-effect-runtime-grammars",
  "svelte-effect-runtime-language-server",
  "svelte-effect-runtime-vsix",
  "docs",
] as const;
const clean_targets: Record<string, CleanTarget> = {
  "svelte-effect-runtime": {
    paths: [
      join(repo_root, ".dist", "svelte-effect-runtime"),
      join(repo_root, "modules", "svelte-effect-runtime", ".dist"),
      join(repo_root, "modules", "svelte-effect-runtime", ".tmp"),
    ],
    files: [
      {
        directory: join(repo_root, "modules", "svelte-effect-runtime"),
        extensions: [".tgz"],
      },
    ],
  },
  "svelte-effect-runtime-grammars": {
    paths: [
      join(repo_root, ".dist", "svelte-effect-runtime-grammars"),
      join(repo_root, "modules", "svelte-effect-runtime-grammars", ".dist"),
    ],
    files: [
      {
        directory: join(repo_root, "modules", "svelte-effect-runtime-grammars"),
        extensions: [".tgz"],
      },
    ],
  },
  "svelte-effect-runtime-language-server": {
    paths: [
      join(repo_root, ".dist", "svelte-effect-runtime-language-server"),
      join(
        repo_root,
        "modules",
        "svelte-effect-runtime-language-server",
        ".dist",
      ),
      join(
        repo_root,
        "modules",
        "svelte-effect-runtime-language-server",
        ".tmp",
      ),
      join(
        repo_root,
        "modules",
        "svelte-effect-runtime-language-server",
        "runtime",
      ),
    ],
    files: [
      {
        directory: join(
          repo_root,
          "modules",
          "svelte-effect-runtime-language-server",
        ),
        extensions: [".tgz"],
      },
    ],
  },
  "svelte-effect-runtime-vsix": {
    paths: [
      join(repo_root, ".dist", "svelte-effect-runtime-vsix"),
      join(repo_root, "modules", "svelte-effect-runtime-vsix", ".dist"),
      join(repo_root, "modules", "svelte-effect-runtime-vsix", "runtime"),
    ],
    files: [
      {
        directory: join(repo_root, "modules", "svelte-effect-runtime-vsix"),
        extensions: [".vsix"],
      },
    ],
  },
  docs: {
    paths: [
      join(repo_root, "modules", "docs", ".next"),
      join(repo_root, "modules", "docs", ".source"),
      join(repo_root, "modules", "docs", ".vercel"),
    ],
  },
};

const resolve_targets = Effect.sync(() =>
  Deno.args.length > 0 ? Deno.args : [...target_names]
);

function validate_targets(targets: string[]) {
  return Effect.sync(() => {
    for (const target of targets) {
      if (!target_names.includes(target as typeof target_names[number])) {
        throw new Error(`Unknown clean target: ${target}`);
      }
    }
  });
}

function clean_targets_by_name(targets: string[]) {
  return Effect.forEach(targets, (target) =>
    Effect.gen(function* () {
      const config = clean_targets[target];

      yield* Effect.forEach(config.paths, remove_path);
      yield* Effect.forEach(
        config.files ?? [],
        (file_config) =>
          remove_matching_files(
            file_config.directory,
            file_config.extensions,
          ),
      );
    }), { discard: true });
}

function remove_path(path: string) {
  return Effect.tryPromise(async () => {
    await Deno.remove(path, { recursive: true }).catch((error) => {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }

      throw error;
    });
  });
}

function remove_matching_files(
  directory: string,
  extensions: string[],
) {
  return Effect.tryPromise(async () => {
    let entries: AsyncIterable<Deno.DirEntry>;

    try {
      entries = Deno.readDir(directory);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }

      throw error;
    }

    for await (const entry of entries) {
      if (!entry.isFile) {
        continue;
      }

      if (!extensions.some((extension) => entry.name.endsWith(extension))) {
        continue;
      }

      await Deno.remove(join(directory, entry.name), { recursive: true });
    }
  });
}

const program = pipe(
  Effect.gen(function* () {
    const targets = yield* resolve_targets;

    yield* validate_targets(targets);
    yield* clean_targets_by_name(targets);

    if (targets.length === target_names.length) {
      yield* remove_path(join(repo_root, ".dist"));
    }
  }),
);

NodeRuntime.runMain(program);
