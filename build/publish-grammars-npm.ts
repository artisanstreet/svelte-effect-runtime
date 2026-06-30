import { dirname, fromFileUrl, join, resolve } from "@std/path";

type PackageManifest = {
  name: string;
  version: string;
  exports?: Record<string, unknown>;
  files?: string[];
  publishConfig?: {
    access?: string;
  };
};

type CommandEnv = Record<string, string>;

type NpmAuth = {
  env: CommandEnv;
  cleanup_dir?: string;
};

type PackEntry = {
  files: Array<{
    path: string;
  }>;
};

const decoder = new TextDecoder();
const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const package_dir = join(
  repo_root,
  "modules",
  "svelte-effect-runtime-grammars",
);
const manifest_path = join(package_dir, "package.json");
const npm = Deno.build.os === "windows" ? "npm.cmd" : "npm";
const deno = Deno.execPath();
const allowed_args = new Set(["--dry-run", "--provenance", "--help", "-h"]);
const dry_run = Deno.args.includes("--dry-run");
const provenance = Deno.args.includes("--provenance");
const help = Deno.args.includes("--help") || Deno.args.includes("-h");
const expected_exports = [
  ".",
  "./textmate",
  "./tree-sitter",
  "./textmate/svelte-effect-runtime.tmLanguage.json",
  "./tree-sitter/highlights.tsq",
  "./tree-sitter/injections.tsq",
];
const expected_files = [
  ".dist/mod.d.ts",
  ".dist/mod.js",
  ".dist/textmate.d.ts",
  ".dist/textmate.js",
  ".dist/tree-sitter.d.ts",
  ".dist/tree-sitter.js",
  ".dist/textmate/svelte-effect-runtime.tmLanguage.json",
  ".dist/tree-sitter/highlights.tsq",
  ".dist/tree-sitter/injections.tsq",
  "README.md",
  "package.json",
];

if (help) {
  print_help();
  Deno.exit(0);
}

for (const arg of Deno.args) {
  if (!allowed_args.has(arg)) {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

const auth = await make_npm_auth();

try {
  const manifest = await read_manifest();
  const package_spec = `${manifest.name}@${manifest.version}`;

  validate_manifest(manifest);

  await run(deno, ["task", "check"], package_dir);
  await run(deno, ["task", "build"], package_dir);
  await assert_dist_files();

  if (!dry_run) {
    await run(npm, ["whoami"], package_dir, auth.env);
  }

  if (await npm_version_exists(package_spec, auth.env)) {
    throw new Error(
      `${package_spec} already exists on npm. Bump the grammar package version before publishing.`,
    );
  }

  await assert_npm_pack(auth.env);

  const publish_args = ["publish", "--access", "public"];

  if (dry_run) {
    publish_args.push("--dry-run");
  } else if (provenance) {
    publish_args.push("--provenance");
  }

  await run(npm, publish_args, package_dir, auth.env);

  if (dry_run) {
    console.log(`[grammars] npm publish dry-run passed for ${package_spec}.`);
  } else {
    console.log(`[grammars] published ${package_spec} to npm.`);
  }
} finally {
  if (auth.cleanup_dir) {
    await Deno.remove(auth.cleanup_dir, { recursive: true }).catch(() =>
      undefined
    );
  }
}

async function read_manifest(): Promise<PackageManifest> {
  const raw = await Deno.readTextFile(manifest_path);
  const manifest = JSON.parse(raw) as PackageManifest;

  return manifest;
}

function validate_manifest(manifest: PackageManifest): void {
  if (manifest.name !== "svelte-effect-runtime-grammars") {
    throw new Error(`Unexpected npm package name: ${manifest.name}`);
  }

  if (!manifest.version) {
    throw new Error("Grammar package manifest is missing a version.");
  }

  if (manifest.publishConfig?.access !== "public") {
    throw new Error("Grammar package publishConfig.access must be public.");
  }

  if (!manifest.files?.includes(".dist")) {
    throw new Error("Grammar package files list must include .dist.");
  }

  if (!manifest.files?.includes("README.md")) {
    throw new Error("Grammar package files list must include README.md.");
  }

  for (const export_path of expected_exports) {
    if (!(export_path in (manifest.exports ?? {}))) {
      throw new Error(`Grammar package is missing export ${export_path}.`);
    }
  }
}

async function assert_dist_files(): Promise<void> {
  for (
    const file of expected_files.filter((path) => path.startsWith(".dist/"))
  ) {
    const file_path = join(package_dir, ...file.split("/"));

    await Deno.stat(file_path).catch(() => {
      throw new Error(`Expected build output is missing: ${file}`);
    });
  }
}

async function assert_npm_pack(env: CommandEnv): Promise<void> {
  const result = await collect(
    npm,
    ["pack", "--dry-run", "--json"],
    package_dir,
    env,
  );

  if (result.code !== 0) {
    throw new Error(
      `npm pack --dry-run failed.\n${result.stderr.trim()}`,
    );
  }

  const entries = JSON.parse(result.stdout) as PackEntry[];
  const packed_files = new Set(
    entries.flatMap((entry) => entry.files.map((file) => file.path)),
  );

  for (const file of expected_files) {
    if (!packed_files.has(file)) {
      throw new Error(`npm package tarball is missing ${file}.`);
    }
  }
}

async function npm_version_exists(
  package_spec: string,
  env: CommandEnv,
): Promise<boolean> {
  const result = await collect(
    npm,
    ["view", package_spec, "version"],
    package_dir,
    env,
  );

  if (result.code === 0) {
    return true;
  }

  if (result.stderr.includes("E404") || result.stderr.includes("404")) {
    return false;
  }

  throw new Error(
    `Failed to query npm for ${package_spec}.\n${result.stderr.trim()}`,
  );
}

async function make_npm_auth(): Promise<NpmAuth> {
  const env = Deno.env.toObject();
  const token = env.NPM_TOKEN;

  if (!token) {
    return { env };
  }

  const cleanup_dir = await Deno.makeTempDir({ prefix: "ser-npm-" });
  const npmrc_path = join(cleanup_dir, ".npmrc");

  await Deno.writeTextFile(
    npmrc_path,
    `//registry.npmjs.org/:_authToken=${token}\n`,
  );

  return {
    env: {
      ...env,
      NPM_CONFIG_USERCONFIG: npmrc_path,
    },
    cleanup_dir,
  };
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  env?: CommandEnv,
): Promise<void> {
  console.log(`[grammars] ${format_command(command, args)}`);

  const result = await new Deno.Command(command, {
    args,
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (result.code !== 0) {
    throw new Error(
      `Command failed with exit code ${result.code}: ${
        format_command(command, args)
      }`,
    );
  }
}

async function collect(
  command: string,
  args: string[],
  cwd: string,
  env?: CommandEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command(command, {
    args,
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

function format_command(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function print_help(): void {
  console.log([
    "Publish the grammar package to npm.",
    "",
    "Usage:",
    "  deno task publish:grammars:npm",
    "  deno task publish:grammars:npm --dry-run",
    "",
    "Options:",
    "  --dry-run     Build and validate the npm tarball without publishing.",
    "  --provenance  Pass --provenance to npm publish.",
    "",
    "Authentication:",
    "  Run npm login first, or set NPM_TOKEN for this command.",
  ].join("\n"));
}
