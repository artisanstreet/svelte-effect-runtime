// deno-lint-ignore-file no-explicit-any
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

import path from "node:path";

const require = createRequire(import.meta.url);
export const ts = require("typescript") as typeof import("typescript");
export const patch_marker = Symbol.for(
  "svelte-effect-runtime.language-server.patch",
);
const package_root = resolve_package_root(
  path.dirname(fileURLToPath(import.meta.url)),
);
const runtime_import_root = resolve_runtime_import_root(package_root);
const language_server_root = path.join(
  path.dirname(require.resolve("svelte-language-server/package.json")),
  "dist",
  "src",
);

export const { Document } = require(path.join(
  language_server_root,
  "lib",
  "documents",
  "Document.js",
)) as { Document: any };
export const { FragmentMapper, SourceMapDocumentMapper } = require(path.join(
  language_server_root,
  "lib",
  "documents",
  "DocumentMapper.js",
)) as { FragmentMapper: any; SourceMapDocumentMapper: any };
export const { extractScriptTags } = require(path.join(
  language_server_root,
  "lib",
  "documents",
  "utils.js",
)) as { extractScriptTags: (code: string) => any };
export const { DocumentSnapshot } = require(path.join(
  language_server_root,
  "plugins",
  "typescript",
  "DocumentSnapshot.js",
)) as { DocumentSnapshot: any };
export const { CodeActionsProviderImpl } = require(path.join(
  language_server_root,
  "plugins",
  "typescript",
  "features",
  "CodeActionsProvider.js",
)) as { CodeActionsProviderImpl: any };
export const {
  TranspiledSvelteDocument,
  FallbackTranspiledSvelteDocument,
} = require(path.join(
  language_server_root,
  "plugins",
  "svelte",
  "SvelteDocument.js",
)) as {
  TranspiledSvelteDocument: any;
  FallbackTranspiledSvelteDocument: any;
};

function resolve_package_root(module_dir: string) {
  if (
    path.basename(module_dir) === ".dist" ||
    path.basename(module_dir) === "src"
  ) {
    return path.dirname(module_dir);
  }

  return module_dir;
}

function resolve_runtime_import_root(package_root: string) {
  const workspace_source_root = path.resolve(
    package_root,
    "..",
    "svelte-effect-runtime",
  );
  const workspace_runtime_root = path.join(workspace_source_root, ".dist");
  const workspace_runtime_source_root = path.join(workspace_source_root, "src");

  if (
    typeof Deno !== "undefined" &&
    existsSync(
      path.join(workspace_runtime_source_root, "runtime", "transform.ts"),
    )
  ) {
    return workspace_runtime_source_root;
  }

  if (existsSync(workspace_runtime_root)) {
    return workspace_runtime_root;
  }

  return package_root;
}

export function import_runtime_module(relative_path: string) {
  const source_relative_path = relative_path.replace(/\.js$/, ".ts");
  const is_source_root = existsSync(path.join(
    runtime_import_root,
    source_relative_path,
  ));
  const resolvedPath = path.join(
    runtime_import_root,
    is_source_root ? source_relative_path : relative_path,
  );

  return import(pathToFileURL(resolvedPath).href);
}
