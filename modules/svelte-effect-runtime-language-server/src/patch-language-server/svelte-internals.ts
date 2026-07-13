/** oxlint-disable no-explicit-any */
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

import path from "node:path";

const require = createRequire(import.meta.url);
export const ts = require("typescript") as typeof import("typescript");
export const patch_marker = Symbol.for("svelte-effect-runtime.language-server.patch");
const package_root = resolve_package_root(path.dirname(fileURLToPath(import.meta.url)));
const runtime_import_root = resolve_runtime_import_root(package_root);
const language_server_root = path.join(
	path.dirname(require.resolve("svelte-language-server/package.json")),
	"dist",
	"src",
);

export const { Document } = require(
	path.join(language_server_root, "lib", "documents", "Document.js"),
) as { Document: any };
export const { FragmentMapper, SourceMapDocumentMapper } = require(
	path.join(language_server_root, "lib", "documents", "DocumentMapper.js"),
) as { FragmentMapper: any; SourceMapDocumentMapper: any };

/**
 * Extracts instance and module script tags with the offsets expected by the
 * Svelte language server's document pipeline.
 *
 * @example
 * ```ts
 * const scripts = extract_script_tags(`<script lang="ts">const count = 1;</script>`);
 * const instance_source = scripts?.script?.content;
 * ```
 *
 * @since 4.0.1
 * @param code - Complete Svelte document source to inspect for script tags.
 * @returns The Svelte language server's extracted script-tag records.
 */
export const extract_script_tags = (
	require(path.join(language_server_root, "lib", "documents", "utils.js")) as {
		extractScriptTags: (code: string) => any;
	}
).extractScriptTags;

export const { DocumentSnapshot } = require(
	path.join(language_server_root, "plugins", "typescript", "DocumentSnapshot.js"),
) as { DocumentSnapshot: any };
export const TypeScriptSnapshotManagerModule = require(
	path.join(language_server_root, "plugins", "typescript", "SnapshotManager.js"),
) as { SnapshotManager: any };
export const TypeScriptSvelteSysModule = require(
	path.join(language_server_root, "plugins", "typescript", "svelte-sys.js"),
) as { createSvelteSys: (tsSystem: any) => any };
export const TypeScriptSvelteUtils = require(
	path.join(language_server_root, "plugins", "typescript", "utils.js"),
) as Record<string, any>;
export const { CodeActionsProviderImpl } = require(
	path.join(language_server_root, "plugins", "typescript", "features", "CodeActionsProvider.js"),
) as { CodeActionsProviderImpl: any };
export const { SvelteDocument, TranspiledSvelteDocument, FallbackTranspiledSvelteDocument } =
	require(path.join(language_server_root, "plugins", "svelte", "SvelteDocument.js")) as {
		SvelteDocument: any;
		TranspiledSvelteDocument: any;
		FallbackTranspiledSvelteDocument: any;
	};

function resolve_package_root(module_dir: string) {
	if (path.basename(module_dir) === ".dist" || path.basename(module_dir) === "src") {
		return path.dirname(module_dir);
	}

	return module_dir;
}

function resolve_runtime_import_root(package_root: string) {
	const workspace_source_root = path.resolve(package_root, "..", "svelte-effect-runtime");
	const workspace_runtime_root = workspace_source_root;
	const workspace_runtime_source_root = path.join(workspace_source_root, "src");

	if (existsSync(path.join(workspace_runtime_source_root, "runtime", "transform.ts"))) {
		return workspace_runtime_source_root;
	}

	if (existsSync(path.join(workspace_runtime_root, "runtime", "transform.js"))) {
		return workspace_runtime_root;
	}

	return package_root;
}

/**
 * Imports a runtime module from source during workspace development or from the
 * packaged runtime assets after publication.
 *
 * @example
 * ```ts
 * const runtime_module = await import_runtime_module("runtime/transform.js");
 * runtime_module.transform_svelte_effect(source, filename);
 * ```
 *
 * @since 2.0.0
 * @param relative_path - Runtime-relative JavaScript module path requested by
 *   the packaged language-server bootstrap.
 * @returns A promise for the matching source or packaged runtime module.
 */
export function import_runtime_module(relative_path: string) {
	const source_relative_path = relative_path.replace(/\.js$/, ".ts");
	const is_source_root = existsSync(path.join(runtime_import_root, source_relative_path));
	const resolved_path = path.join(
		runtime_import_root,
		is_source_root ? source_relative_path : relative_path,
	);

	return import(pathToFileURL(resolved_path).href);
}
