import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const dist_root = join(
  repo_root,
  ".dist",
  "svelte-effect-runtime",
).replaceAll("\\", "/");

const alias_patterns = [
  {
    prefix: "$/",
    resolve(specifier: string): string {
      return specifier.slice(2).replace(/\.ts$/, ".js");
    },
  },
] as const;

function to_posix_relative(from_file: string, target_from_dist: string): string {
  const target = `${dist_root}/${target_from_dist}`.replaceAll("\\", "/");
  const from_dir = from_file.slice(0, from_file.lastIndexOf("/"));
  const rel = relative(from_dir, target).replaceAll("\\", "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function rewrite_alias_specifiers(file_path: string, content: string): string {
  return content.replace(/(["'])(\$\/[^"']+\.ts)\1/g, (
    match,
    quote: string,
    specifier: string,
  ) => {
    const alias = alias_patterns.find(({ prefix }) => specifier.startsWith(prefix));
    if (!alias) return match;
    return `${quote}${to_posix_relative(file_path, alias.resolve(specifier))}${quote}`;
  });
}

for await (const entry of Deno.readDir(dist_root)) {
  await visit(entry.name);
}

async function visit(relative_path: string): Promise<void> {
  const file_path = `${dist_root}/${relative_path}`.replaceAll("\\", "/");
  const stat = await Deno.stat(file_path);

  if (stat.isDirectory) {
    for await (const entry of Deno.readDir(file_path)) {
      await visit(`${relative_path}/${entry.name}`);
    }
    return;
  }

  if (!file_path.endsWith(".d.ts")) return;

  const content = await Deno.readTextFile(file_path);
  const rewritten = rewrite_alias_specifiers(file_path, content);

  if (rewritten !== content) {
    await Deno.writeTextFile(file_path, rewritten);
  }
}
