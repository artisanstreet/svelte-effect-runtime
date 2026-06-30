import { dirname, fromFileUrl, join, resolve } from "@std/path";

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
const requested_targets = Deno.args.length > 0 ? Deno.args : [...target_names];

for (const target of requested_targets) {
  if (!target_names.includes(target as typeof target_names[number])) {
    throw new Error(`Unknown clean target: ${target}`);
  }
}

for (const target of requested_targets) {
  const config = clean_targets[target];

  for (const path of config.paths) {
    await remove_path(path);
  }

  for (const file_config of config.files ?? []) {
    await remove_matching_files(file_config.directory, file_config.extensions);
  }
}

if (requested_targets.length === target_names.length) {
  await remove_path(join(repo_root, ".dist"));
}

async function remove_path(path: string): Promise<void> {
  await Deno.remove(path, { recursive: true }).catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }

    throw error;
  });
}

async function remove_matching_files(
  directory: string,
  extensions: string[],
): Promise<void> {
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

    await remove_path(join(directory, entry.name));
  }
}
