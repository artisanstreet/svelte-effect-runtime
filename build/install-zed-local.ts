import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { copy } from "@std/fs/copy";

const repo_root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const local_app_data = Deno.env.get("LOCALAPPDATA");

if (!local_app_data) {
  throw new Error(
    "LOCALAPPDATA is required to install the local Zed extension.",
  );
}

const extension_dir = join(
  repo_root,
  "modules",
  "svelte-effect-runtime-zed",
);
const language_server_dir = join(
  repo_root,
  "modules",
  "svelte-effect-runtime-language-server",
);
const installed_dir = join(
  local_app_data,
  "Zed",
  "extensions",
  "installed",
  "svelte-effect-runtime",
);
const installed_language_server_dir = join(
  installed_dir,
  "node_modules",
  "svelte-effect-runtime-language-server",
);
const wasm_source = join(
  extension_dir,
  "target",
  "wasm32-wasip2",
  "release",
  "zed_svelte_effect_runtime.wasm",
);
const manifest_source = join(extension_dir, "extension.toml");
const index_path = join(local_app_data, "Zed", "extensions", "index.json");

await assert_file(wasm_source, "Build the Zed extension before installing.");
await assert_file(
  join(language_server_dir, ".dist", "server.cjs"),
  "Build the language server before installing.",
);
await assert_file(
  join(language_server_dir, "runtime", "package.json"),
  "Build the language server runtime assets before installing.",
);

await Deno.mkdir(installed_dir, { recursive: true });
await Deno.remove(installed_language_server_dir, { recursive: true })
  .catch(() => undefined);
await Deno.mkdir(installed_language_server_dir, { recursive: true });

await Deno.copyFile(wasm_source, join(installed_dir, "extension.wasm"));
await Deno.copyFile(manifest_source, join(installed_dir, "extension.toml"));

for (const name of ["package.json", "README.md"]) {
  await Deno.copyFile(
    join(language_server_dir, name),
    join(installed_language_server_dir, name),
  );
}

for (const name of [".dist", "runtime"]) {
  await copy(
    join(language_server_dir, name),
    join(installed_language_server_dir, name),
    { overwrite: true },
  );
}

await update_zed_extension_index(
  index_path,
  await read_manifest(manifest_source),
);

console.log(JSON.stringify(
  {
    extension: installed_dir,
    language_server: installed_language_server_dir,
    server: join(installed_language_server_dir, ".dist", "server.cjs"),
  },
  null,
  2,
));

async function assert_file(path: string, hint: string): Promise<void> {
  const stat = await Deno.stat(path).catch(() => undefined);

  if (!stat?.isFile) {
    throw new Error(`${hint} Missing file: ${path}`);
  }
}

async function read_manifest(path: string): Promise<ZedManifest> {
  const content = await Deno.readTextFile(path);
  const language_server = content.match(
    /\[language_servers\.([^\]]+)\]/,
  )?.[1];

  if (!language_server) {
    throw new Error(`Missing language server section in ${path}`);
  }

  return {
    id: read_toml_string(content, "id"),
    name: read_toml_string(content, "name"),
    description: read_toml_string(content, "description"),
    version: read_toml_string(content, "version"),
    repository: read_toml_string(content, "repository"),
    authors: read_toml_string_array(content, "authors"),
    language_server,
  };
}

async function update_zed_extension_index(
  path: string,
  manifest: ZedManifest,
): Promise<void> {
  const raw = await Deno.readTextFile(path).catch(() => undefined);
  const index = raw ? JSON.parse(raw) as ZedExtensionIndex : { extensions: {} };
  const existing = index.extensions[manifest.id]?.manifest ?? {};

  index.extensions[manifest.id] = {
    manifest: {
      ...existing,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      schema_version: 1,
      description: manifest.description,
      repository: manifest.repository,
      authors: manifest.authors,
      lib: {
        kind: "Rust",
        version: null,
      },
      themes: existing.themes ?? [],
      icon_themes: existing.icon_themes ?? [],
      languages: existing.languages ?? [],
      grammars: existing.grammars ?? {},
      language_servers: {
        [manifest.language_server]: {
          language: "Svelte",
          languages: [],
          language_ids: {},
          code_action_kinds: null,
        },
      },
      context_servers: existing.context_servers ?? {},
      slash_commands: existing.slash_commands ?? {},
      snippets: existing.snippets ?? null,
      capabilities: existing.capabilities ?? [],
    },
    dev: false,
  };

  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, `${JSON.stringify(index, null, 2)}\n`);
}

function read_toml_string(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));

  if (!match) {
    throw new Error(`Missing ${key} in extension.toml`);
  }

  return match[1];
}

function read_toml_string_array(content: string, key: string): string[] {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*\\[(.+)\\]`, "m"));

  if (!match) {
    throw new Error(`Missing ${key} in extension.toml`);
  }

  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

interface ZedManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  repository: string;
  authors: string[];
  language_server: string;
}

interface ZedExtensionIndex {
  extensions: Record<string, {
    manifest: Record<string, unknown>;
    dev: boolean;
  }>;
}
