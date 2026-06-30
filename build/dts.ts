import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { Effect, pipe } from "effect";
import { copy } from "@std/fs/copy";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

type AliasPattern = {
  prefix: string;
  resolve(specifier: string): string;
};

type TargetConfig = {
  aliases: AliasPattern[];
};

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const targets: Record<string, TargetConfig> = {
  "svelte-effect-runtime": {
    aliases: [
      {
        prefix: "$/",
        resolve(specifier: string): string {
          return specifier.slice(2).replace(/\.ts$/, ".js");
        },
      },
    ],
  },
  "svelte-effect-runtime-grammars": {
    aliases: [],
  },
};

type TargetContext = {
  package_name: string;
  package_dist: string;
  dist_root: string;
  target: TargetConfig;
};

const resolve_target = Effect.sync((): TargetContext => {
  const package_name = Deno.args[0];

  if (!package_name) {
    throw new Error("Expected package name.");
  }

  const target = targets[package_name];

  if (!target) {
    throw new Error(`Unknown declaration target: ${package_name}`);
  }

  return {
    package_name,
    target,
    package_dist: join(repo_root, "modules", package_name, ".dist"),
    dist_root: join(repo_root, ".dist", package_name).replaceAll("\\", "/"),
  };
});

function visit_root(context: TargetContext) {
  return Effect.tryPromise(async () => {
    for await (const entry of Deno.readDir(context.dist_root)) {
      await visit(context, entry.name);
    }
  });
}

async function visit(
  context: TargetContext,
  relative_path: string,
): Promise<void> {
  const file_path = `${context.dist_root}/${relative_path}`.replaceAll(
    "\\",
    "/",
  );
  const stat = await Deno.stat(file_path);

  if (stat.isDirectory) {
    for await (const entry of Deno.readDir(file_path)) {
      await visit(context, `${relative_path}/${entry.name}`);
    }

    return;
  }

  if (!file_path.endsWith(".d.ts")) {
    return;
  }

  const content = await Deno.readTextFile(file_path);
  const rewritten = rewrite_relative_specifiers(
    rewrite_alias_specifiers(context, file_path, content),
  );

  if (rewritten !== content) {
    await Deno.writeTextFile(file_path, rewritten);
  }
}

function copy_dist(context: TargetContext) {
  return Effect.tryPromise(async () => {
    await Deno.remove(context.package_dist, { recursive: true }).catch(() =>
      undefined
    );
    await copy(context.dist_root, context.package_dist, { overwrite: true });
  });
}

function rewrite_alias_specifiers(
  context: TargetContext,
  file_path: string,
  content: string,
): string {
  if (context.target.aliases.length === 0) {
    return content;
  }

  return content.replace(/(["'])(\$\/[^"']+\.ts)\1/g, (
    match,
    quote: string,
    specifier: string,
  ) => {
    const alias = context.target.aliases.find(({ prefix }) =>
      specifier.startsWith(prefix)
    );

    if (!alias) {
      return match;
    }

    return `${quote}${
      to_posix_relative(context, file_path, alias.resolve(specifier))
    }${quote}`;
  });
}

function rewrite_relative_specifiers(content: string): string {
  return content.replace(
    /((?:from|import)\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/g,
    "$1$2.js$3",
  );
}

function to_posix_relative(
  context: TargetContext,
  from_file: string,
  target_from_dist: string,
): string {
  const resolved_target = `${context.dist_root}/${target_from_dist}`.replaceAll(
    "\\",
    "/",
  );
  const from_dir = from_file.slice(0, from_file.lastIndexOf("/"));
  const relative_path = relative(from_dir, resolved_target).replaceAll(
    "\\",
    "/",
  );

  return relative_path.startsWith(".") ? relative_path : `./${relative_path}`;
}

const program = pipe(
  Effect.gen(function* () {
    const context = yield* resolve_target;

    yield* visit_root(context);
    yield* copy_dist(context);
  }),
);

NodeRuntime.runMain(program);
