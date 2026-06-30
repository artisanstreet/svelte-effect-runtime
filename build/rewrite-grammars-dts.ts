import { copy } from "@std/fs/copy";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const package_dist = join(
  repo_root,
  "modules",
  "svelte-effect-runtime-grammars",
  ".dist",
);
const dist_root = join(
  repo_root,
  ".dist",
  "svelte-effect-runtime-grammars",
).replaceAll("\\", "/");

function rewrite_relative_specifiers(content: string): string {
  return content.replace(
    /((?:from|import)\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/g,
    "$1$2.js$3",
  );
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

  if (!file_path.endsWith(".d.ts")) {
    return;
  }

  const content = await Deno.readTextFile(file_path);
  const rewritten = rewrite_relative_specifiers(content);

  if (rewritten !== content) {
    await Deno.writeTextFile(file_path, rewritten);
  }
}

await Deno.remove(package_dist, { recursive: true }).catch(() => undefined);
await copy(dist_root, package_dist, { overwrite: true });
