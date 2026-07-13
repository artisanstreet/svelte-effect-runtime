/** oxlint-disable no-explicit-any */
import { Context, Data, Effect, FileSystem, Layer, Path } from "effect";
import { createRequire } from "node:module";
import type { Mapper } from "./types.ts";

type RuntimeTransformModule =
	typeof import("../../../svelte-effect-runtime/src/runtime/transform.ts");

/**
 * Reports a private language-server module or runtime transform that could not
 * be loaded during bootstrap.
 *
 * @example
 * ```ts
 * if (error._tag === "LanguageServerDependencyError") {
 * 	console.error(error.dependency, error.cause);
 * }
 * ```
 *
 * @since 4.0.1
 */
export class LanguageServerDependencyError extends Data.TaggedError(
	"LanguageServerDependencyError",
)<{
	readonly dependency: string;
	readonly cause: unknown;
	readonly message: string;
}> {}

const require = createRequire(import.meta.url);

/**
 * Private Svelte and TypeScript language-server modules loaded by the
 * bootstrap layer.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 * 	const internals = yield* SvelteInternals;
 * 	return internals.typescript.version;
 * });
 * ```
 *
 * @since 4.0.1
 */
export interface SvelteInternalsService {
	readonly typescript: typeof import("typescript");
	readonly document: {
		createForTest(uri: string, text: string): any;
	};
	readonly fragment_mapper: new (
		document_text: string,
		tag_info: unknown,
		source_uri: string,
	) => Mapper;
	readonly source_map_document_mapper: new (trace_map: unknown, source_uri: string) => Mapper;
	readonly extract_script_tags: (code: string) => any;
	readonly document_snapshot: {
		fromDocument: any;
		fromSvelteFilePath: any;
		fromFilePath: any;
	};
	readonly snapshot_manager_module: { SnapshotManager: any };
	readonly svelte_sys_module: { createSvelteSys: any };
	readonly svelte_utils: Record<PropertyKey, any>;
	readonly code_actions_provider: any;
	readonly svelte_document: any;
	readonly transpiled_svelte_document: any;
	readonly fallback_transpiled_svelte_document: any;
}

/**
 * Loaded private modules used to extend the Svelte and TypeScript language
 * server pipelines.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 * 	const internals = yield* SvelteInternals;
 * 	return internals.typescript.version;
 * });
 * ```
 *
 * @since 4.0.1
 */
export class SvelteInternals extends Context.Service<SvelteInternals, SvelteInternalsService>()(
	"svelte-effect-runtime-language-server/SvelteInternals",
) {}

/**
 * Loads the Svelte language server's private modules into a typed service.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 * 	return yield* SvelteInternals;
 * }).pipe(
 * 	Effect.provide(SvelteInternalsLive),
 * 	Effect.provide(NodeServices.layer),
 * );
 * ```
 *
 * @since 4.0.1
 */
export const SvelteInternalsLive = Layer.effect(
	SvelteInternals,
	Effect.gen(function* () {
		const path_service = yield* Path.Path;
		const language_server_manifest = yield* ResolveModule(
			"svelte-language-server/package.json",
		);
		const language_server_root = path_service.join(
			path_service.dirname(language_server_manifest),
			"dist",
			"src",
		);
		const typescript = yield* RequireModule<typeof import("typescript")>("typescript");
		const document_module = yield* RequireModule<{ Document: any }>(
			path_service.join(language_server_root, "lib", "documents", "Document.js"),
		);
		const document_mapper_module = yield* RequireModule<{
			FragmentMapper: any;
			SourceMapDocumentMapper: any;
		}>(path_service.join(language_server_root, "lib", "documents", "DocumentMapper.js"));
		const document_utils_module = yield* RequireModule<{
			extractScriptTags: (code: string) => any;
		}>(path_service.join(language_server_root, "lib", "documents", "utils.js"));
		const document_snapshot_module = yield* RequireModule<{ DocumentSnapshot: any }>(
			path_service.join(language_server_root, "plugins", "typescript", "DocumentSnapshot.js"),
		);
		const snapshot_manager_module = yield* RequireModule<{ SnapshotManager: any }>(
			path_service.join(language_server_root, "plugins", "typescript", "SnapshotManager.js"),
		);
		const svelte_sys_module = yield* RequireModule<{
			createSvelteSys: (ts_system: any) => any;
		}>(path_service.join(language_server_root, "plugins", "typescript", "svelte-sys.js"));
		const svelte_utils = yield* RequireModule<Record<PropertyKey, any>>(
			path_service.join(language_server_root, "plugins", "typescript", "utils.js"),
		);
		const code_actions_module = yield* RequireModule<{ CodeActionsProviderImpl: any }>(
			path_service.join(
				language_server_root,
				"plugins",
				"typescript",
				"features",
				"CodeActionsProvider.js",
			),
		);
		const svelte_document_module = yield* RequireModule<{
			SvelteDocument: any;
			TranspiledSvelteDocument: any;
			FallbackTranspiledSvelteDocument: any;
		}>(path_service.join(language_server_root, "plugins", "svelte", "SvelteDocument.js"));

		return {
			typescript,
			document: document_module.Document,
			fragment_mapper: document_mapper_module.FragmentMapper,
			source_map_document_mapper: document_mapper_module.SourceMapDocumentMapper,
			extract_script_tags: document_utils_module.extractScriptTags,
			document_snapshot: document_snapshot_module.DocumentSnapshot,
			snapshot_manager_module,
			svelte_sys_module,
			svelte_utils,
			code_actions_provider: code_actions_module.CodeActionsProviderImpl,
			svelte_document: svelte_document_module.SvelteDocument,
			transpiled_svelte_document: svelte_document_module.TranspiledSvelteDocument,
			fallback_transpiled_svelte_document:
				svelte_document_module.FallbackTranspiledSvelteDocument,
		};
	}),
);

/**
 * Runtime transforms loaded from workspace source or packaged JavaScript.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 * 	const transforms = yield* RuntimeTransforms;
 * 	return transforms.transform_script_effect(source, filename);
 * });
 * ```
 *
 * @since 4.0.1
 */
export class RuntimeTransforms extends Context.Service<
	RuntimeTransforms,
	Pick<
		RuntimeTransformModule,
		"transform_markup_effect" | "transform_script_effect" | "transform_svelte_effect"
	>
>()("svelte-effect-runtime-language-server/RuntimeTransforms") {}

/**
 * Loads SER transforms from source in the workspace and packaged assets after
 * publication.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 * 	return yield* RuntimeTransforms;
 * }).pipe(
 * 	Effect.provide(RuntimeTransformsLive),
 * 	Effect.provide(NodeServices.layer),
 * );
 * ```
 *
 * @since 4.0.1
 */
export const RuntimeTransformsLive = Layer.effect(
	RuntimeTransforms,
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const package_root = yield* ResolvePackageRoot;
		const workspace_runtime_root = path_service.resolve(
			package_root,
			"..",
			"svelte-effect-runtime",
		);
		const workspace_runtime_source_root = path_service.join(workspace_runtime_root, "src");
		const source_transform_path = path_service.join(
			workspace_runtime_source_root,
			"runtime",
			"transform.ts",
		);
		const packaged_transform_path = path_service.join(package_root, "runtime", "transform.js");
		const has_packaged_transform = yield* Effect.mapError(
			file_system.exists(packaged_transform_path),
			(cause) => make_dependency_error(packaged_transform_path, cause),
		);
		const has_source_transform = has_packaged_transform
			? false
			: yield* Effect.mapError(file_system.exists(source_transform_path), (cause) =>
					make_dependency_error(source_transform_path, cause),
				);
		const resolved_path = has_packaged_transform
			? packaged_transform_path
			: has_source_transform
				? source_transform_path
				: packaged_transform_path;
		const module_url = yield* Effect.mapError(path_service.toFileUrl(resolved_path), (cause) =>
			make_dependency_error(resolved_path, cause),
		);
		const runtime_module = yield* Effect.tryPromise({
			try: () => import(module_url.href) as Promise<RuntimeTransformModule>,
			catch: (cause) => make_dependency_error(resolved_path, cause),
		});

		return {
			transform_markup_effect: runtime_module.transform_markup_effect,
			transform_script_effect: runtime_module.transform_script_effect,
			transform_svelte_effect: runtime_module.transform_svelte_effect,
		};
	}),
);

export const patch_marker = Symbol.for("svelte-effect-runtime.language-server.patch");

const ResolvePackageRoot = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path_service = yield* Path.Path;
	const module_path = yield* Effect.mapError(
		path_service.fromFileUrl(new URL(import.meta.url)),
		(cause) => make_dependency_error(import.meta.url, cause),
	);
	let directory = path_service.dirname(module_path);
	const parent_directory = path_service.dirname(directory);

	if (path_service.basename(directory) === ".dist") {
		return parent_directory;
	}

	if (path_service.basename(parent_directory) === ".dist") {
		return directory;
	}

	while (true) {
		const manifest_path = path_service.join(directory, "package.json");
		const has_manifest = yield* Effect.mapError(file_system.exists(manifest_path), (cause) =>
			make_dependency_error(manifest_path, cause),
		);

		if (has_manifest) {
			return directory;
		}

		const parent = path_service.dirname(directory);

		if (parent === directory) {
			return yield* Effect.fail(
				make_dependency_error(module_path, new Error("No package manifest was found")),
			);
		}

		directory = parent;
	}
});

function ResolveModule(module_path: string) {
	return Effect.gen(function* () {
		return yield* Effect.try({
			try: () => require.resolve(module_path),
			catch: (cause) => make_dependency_error(module_path, cause),
		});
	});
}

function RequireModule<Module>(module_path: string) {
	return Effect.gen(function* () {
		return yield* Effect.try({
			try: () => require(module_path) as Module,
			catch: (cause) => make_dependency_error(module_path, cause),
		});
	});
}

function make_dependency_error(dependency: string, cause: unknown) {
	return new LanguageServerDependencyError({
		dependency,
		cause,
		message: `Failed to load language-server dependency: ${dependency}`,
	});
}
