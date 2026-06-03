import { copy } from "@std/fs/copy";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

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
const staging_dir = await Deno.makeTempDir({
  prefix: "svelte-effect-runtime-vsix-",
});
const staging_dist_dir = join(staging_dir, ".dist");
const required_runtime_dependencies = [
  "@jridgewell/trace-mapping",
  "magic-string",
  "svelte",
  "svelte-language-server",
  "typescript",
  "vscode-languageclient",
  "vscode-languageserver",
];

await Deno.mkdir(staging_dist_dir, { recursive: true });
await copy(join(output_dir, "chunks"), join(staging_dist_dir, "chunks"), {
  overwrite: true,
}).catch(
  (error) => {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  },
);
for (
  const filename of [
    "extension.js",
    "extension.js.map",
    "server.cjs",
    "server.cjs.map",
  ]
) {
  await Deno.copyFile(
    join(output_dir, filename),
    join(staging_dist_dir, filename),
  )
    .catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    });
}
await copy(join(output_dir, "runtime"), join(staging_dir, "runtime"), {
  overwrite: true,
});
await Deno.copyFile(
  join(package_dir, "README.md"),
  join(staging_dir, "README.md"),
);

const manifest = JSON.parse(
  await Deno.readTextFile(join(package_dir, "package.json")),
);
await Deno.writeTextFile(
  join(staging_dir, "package.json"),
  `${JSON.stringify(include_packaged_node_modules(manifest), null, 2)}\n`,
);

const install_result = await new Deno.Command("npm", {
  args: [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-package-lock",
    "--no-audit",
    "--no-fund",
  ],
  cwd: staging_dir,
  stdout: "inherit",
  stderr: "inherit",
}).output();

if (install_result.code !== 0) {
  await Deno.remove(staging_dir, { recursive: true }).catch(() => undefined);
  Deno.exit(install_result.code);
}

await assert_runtime_dependencies_installed(
  staging_dir,
  required_runtime_dependencies,
);

const output_name = `${manifest.name}-${manifest.version}.vsix`;
await Deno.mkdir(output_dir, { recursive: true });
await Deno.remove(join(output_dir, output_name), { recursive: true }).catch(
  () => undefined,
);
const package_result = await new Deno.Command("npx", {
  args: [
    "--yes",
    "@vscode/vsce@3.7.1",
    "package",
    "--allow-missing-repository",
    "--out",
    join(output_dir, output_name),
  ],
  cwd: staging_dir,
  stdout: "inherit",
  stderr: "inherit",
}).output();

await Deno.remove(staging_dir, { recursive: true }).catch(() => undefined);

if (package_result.code !== 0) {
  Deno.exit(package_result.code);
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
