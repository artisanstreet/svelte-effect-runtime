/** oxlint-disable no-explicit-any */
import { type SvelteInternalsService, SvelteInternals, patch_marker } from "./svelte-internals.ts";
import { rebind_snapshot_to_original_document } from "./snapshot.ts";
import { prepare_virtual_document } from "./virtual-document.ts";
import { is_invalid_position } from "./document-mappers.ts";
import type { TransformSet } from "./types.ts";
import { Effect } from "effect";

type TransformSvelteEffect = (
	code: string,
	filename?: string,
	options?: { target?: "editor" },
) => { code: string };

const svelte_file_extensions = [".svelte", ".sv"];
const virtual_svelte_file_extensions = [
	{ source: ".svelte", virtual: ".d.svelte.ts" },
	{ source: ".sv", virtual: ".d.sv.ts" },
];

export function PatchSvelteFileExtensions() {
	return Effect.gen(function* () {
		const internals = yield* SvelteInternals;

		yield* Effect.sync(() => {
			const { svelte_utils } = internals;

			if (svelte_utils[patch_marker]) {
				return;
			}

			svelte_utils.isSvelteFilePath = is_svelte_file_path;
			svelte_utils.isVirtualSvelteFilePath = is_virtual_svelte_file_path;
			svelte_utils.toRealSvelteFilePath = to_real_svelte_file_path;
			svelte_utils.toVirtualSvelteFilePath = to_virtual_svelte_file_path;
			svelte_utils.ensureRealSvelteFilePath = ensure_real_svelte_file_path;

			patch_svelte_sys_file_extensions(internals);
			patch_snapshot_manager_file_extensions(internals);
			svelte_utils[patch_marker] = true;
		});
	});
}

export function PatchSvelteCompilerPath(transform_svelte_effect: TransformSvelteEffect) {
	return Effect.gen(function* () {
		const internals = yield* SvelteInternals;

		yield* Effect.sync(() => {
			const effect_preprocessor =
				create_effect_transform_preprocessor(transform_svelte_effect);
			const { typescript } = internals;

			patch_static_factory(internals.transpiled_svelte_document, (original_create: any) => {
				return function create(this: unknown, document: unknown, config: any) {
					const preprocess = merge_preprocessors(
						config?.preprocess,
						effect_preprocessor,
						typescript,
					);

					return original_create.call(
						this,
						document,
						with_async_compiler_options({
							...config,
							preprocess,
						}),
					);
				};
			});

			patch_static_factory(
				internals.fallback_transpiled_svelte_document,
				(original_create: any) => {
					return function create(
						this: unknown,
						document: unknown,
						preprocessors: any[] = [],
					) {
						return original_create.call(
							this,
							document,
							merge_preprocessors(preprocessors, effect_preprocessor, typescript),
						);
					};
				},
			);

			patch_svelte_document_compile_options(internals);
		});
	});
}

export function PatchTypeScriptSnapshotPath(transforms: TransformSet) {
	return Effect.gen(function* () {
		const internals = yield* SvelteInternals;

		yield* Effect.sync(() => {
			const { document_snapshot } = internals;

			if (document_snapshot.fromDocument[patch_marker]) {
				return;
			}

			const original_from_document = document_snapshot.fromDocument;

			document_snapshot.fromDocument = function fromDocument(
				this: unknown,
				document: any,
				options: any,
			) {
				const prepared = prepare_virtual_document(document, transforms, internals);

				if (!prepared) {
					return original_from_document.call(this, document, options);
				}

				const snapshot = original_from_document.call(this, prepared.document, options);

				return rebind_snapshot_to_original_document(snapshot, document, prepared);
			};
			document_snapshot.fromDocument[patch_marker] = true;

			document_snapshot.fromSvelteFilePath = function fromSvelteFilePath(
				file_path: string,
				create_document: (path: string, text: string) => any,
				options: any,
				ts_system: { readFile(path: string): string | undefined },
			) {
				const original_text = ts_system.readFile(file_path) ?? "";

				return document_snapshot.fromDocument(
					create_document(file_path, original_text),
					options,
				);
			};
			document_snapshot.fromSvelteFilePath[patch_marker] = true;
		});
	});
}

function patch_static_factory(target_class: any, make_replacement: (original_create: any) => any) {
	if (target_class.create[patch_marker]) {
		return;
	}

	const original_create = target_class.create;

	target_class.create = make_replacement(original_create);
	target_class.create[patch_marker] = true;
}

function patch_svelte_document_compile_options(internals: SvelteInternalsService) {
	const { svelte_document } = internals;

	if (svelte_document.prototype.getCompiledWith?.[patch_marker]) {
		return;
	}

	const original_get_compiled_with = svelte_document.prototype.getCompiledWith;

	svelte_document.prototype.getCompiledWith = function getCompiledWith(
		this: unknown,
		options: any = {},
	) {
		return original_get_compiled_with.call(this, with_async_compile_options(options));
	};
	svelte_document.prototype.getCompiledWith[patch_marker] = true;
}

function patch_svelte_sys_file_extensions(internals: SvelteInternalsService) {
	const { svelte_sys_module } = internals;

	if (svelte_sys_module.createSvelteSys[patch_marker]) {
		return;
	}

	svelte_sys_module.createSvelteSys = function createSvelteSys(ts_system: any) {
		return create_svelte_sys(ts_system);
	};
	svelte_sys_module.createSvelteSys[patch_marker] = true;
}

function patch_snapshot_manager_file_extensions(internals: SvelteInternalsService) {
	const { snapshot_manager_module } = internals;

	if (snapshot_manager_module.SnapshotManager[patch_marker]) {
		return;
	}

	const OriginalSnapshotManager = snapshot_manager_module.SnapshotManager;

	snapshot_manager_module.SnapshotManager = class SnapshotManager extends (
		OriginalSnapshotManager
	) {
		constructor(...args: any[]) {
			super(...args);

			this.watchExtensions = with_svelte_file_extensions(this.watchExtensions);
		}
	};
	snapshot_manager_module.SnapshotManager[patch_marker] = true;
}

function create_svelte_sys(ts_system: any) {
	const file_exists_cache = create_file_exists_cache(ts_system);

	function svelte_file_exists(path: string) {
		if (!is_virtual_svelte_file_path(path)) {
			return false;
		}

		const svelte_path = to_real_svelte_file_path(path);
		const dts_path = `${svelte_path}.d.ts`;
		const dts_path_exists = file_exists_cache.get(dts_path);

		if (dts_path_exists) {
			return false;
		}

		const svelte_dts_path_exists = file_exists_cache.get(path);

		if (svelte_dts_path_exists) {
			return false;
		}

		return file_exists_cache.get(svelte_path);
	}

	function get_real_svelte_path_if_exists(path: string) {
		return svelte_file_exists(path) ? to_real_svelte_file_path(path) : path;
	}

	const svelte_sys = {
		...ts_system,
		svelteFileExists: svelte_file_exists,
		getRealSveltePathIfExists: get_real_svelte_path_if_exists,
		fileExists(path: string) {
			if (svelte_file_exists(path)) {
				return true;
			}

			return file_exists_cache.get(path);
		},
		readFile(path: string) {
			return ts_system.readFile(get_real_svelte_path_if_exists(path));
		},
		readDirectory(
			path: string,
			extensions?: readonly string[],
			exclude?: readonly string[],
			include?: readonly string[],
			depth?: number,
		) {
			return ts_system.readDirectory(
				path,
				with_svelte_file_extensions(extensions),
				exclude,
				include,
				depth,
			);
		},
		deleteFile(path: string) {
			delete_svelte_file_cache_entries(file_exists_cache, path);

			return ts_system.deleteFile?.(path);
		},
		deleteFromCache(path: string) {
			delete_svelte_file_cache_entries(file_exists_cache, path);
		},
	};

	if (ts_system.realpath) {
		const realpath = ts_system.realpath;

		svelte_sys.realpath = function realpath_svelte_file(path: string) {
			if (svelte_file_exists(path)) {
				return realpath(to_real_svelte_file_path(path));
			}

			return realpath(path);
		};
	}

	return svelte_sys;
}

function create_file_exists_cache(ts_system: any) {
	const cache = new Map<string, boolean>();
	const get_key = (path: string) =>
		ts_system.useCaseSensitiveFileNames ? path : path.toLowerCase();

	return {
		get(path: string) {
			const key = get_key(path);
			const cached = cache.get(key);

			if (cached !== undefined) {
				return cached;
			}

			const exists = ts_system.fileExists(path);

			cache.set(key, exists);

			return exists;
		},
		delete(path: string) {
			cache.delete(get_key(path));
		},
	};
}

function delete_svelte_file_cache_entries(
	cache: ReturnType<typeof create_file_exists_cache>,
	path: string,
) {
	const real_path = ensure_real_svelte_file_path(path);

	cache.delete(path);
	cache.delete(real_path);

	if (is_svelte_file_path(real_path)) {
		cache.delete(to_virtual_svelte_file_path(real_path));
		cache.delete(`${real_path}.d.ts`);
	}
}

function with_svelte_file_extensions(extensions: readonly string[] | undefined) {
	if (!extensions) {
		return undefined;
	}

	return [...new Set([...extensions, ...svelte_file_extensions])];
}

function is_svelte_file_path(file_path: string) {
	return svelte_file_extensions.some((extension) => file_path.endsWith(extension));
}

function is_virtual_svelte_file_path(file_path: string) {
	return virtual_svelte_file_extensions.some(({ virtual }) => file_path.endsWith(virtual));
}

function to_real_svelte_file_path(file_path: string) {
	const extension = virtual_svelte_file_extensions.find(({ virtual }) =>
		file_path.endsWith(virtual),
	);

	if (!extension) {
		return file_path;
	}

	return file_path.slice(0, -extension.virtual.length) + extension.source;
}

function to_virtual_svelte_file_path(file_path: string) {
	if (is_virtual_svelte_file_path(file_path)) {
		return file_path;
	}

	const extension = virtual_svelte_file_extensions.find(({ source }) =>
		file_path.endsWith(source),
	);

	if (!extension) {
		return file_path;
	}

	return file_path.slice(0, -extension.source.length) + extension.virtual;
}

function ensure_real_svelte_file_path(file_path: string) {
	return is_virtual_svelte_file_path(file_path) ? to_real_svelte_file_path(file_path) : file_path;
}

export function PatchTypeScriptCodeActions() {
	return Effect.gen(function* () {
		const internals = yield* SvelteInternals;

		yield* Effect.sync(() => {
			const { code_actions_provider } = internals;

			if (code_actions_provider.prototype.applyQuickfix?.[patch_marker]) {
				return;
			}

			const original_apply_quickfix = code_actions_provider.prototype.applyQuickfix;

			code_actions_provider.prototype.applyQuickfix = async function applyQuickfix(
				document: any,
				range: { start: any; end: any },
				context: any,
				cancellation_token: any,
			) {
				const { tsDoc: ts_doc } = await this.getLSAndTSDoc(document);
				const generated_start = ts_doc.getGeneratedPosition(range.start);
				const generated_end = ts_doc.getGeneratedPosition(range.end);

				if (is_invalid_position(generated_start) || is_invalid_position(generated_end)) {
					return [];
				}

				const start = ts_doc.offsetAt(generated_start);
				const end = ts_doc.offsetAt(generated_end);

				if (end < start) {
					return [];
				}

				return original_apply_quickfix.call(
					this,
					document,
					range,
					context,
					cancellation_token,
				);
			};
			code_actions_provider.prototype.applyQuickfix[patch_marker] = true;
		});
	});
}

function merge_preprocessors(
	existing: any,
	effect_preprocessor: any,
	typescript: typeof import("typescript"),
) {
	if (contains_effect_preprocessor(existing)) {
		return existing;
	}

	if (!existing) {
		return [effect_preprocessor, create_typescript_fallback_preprocessor(typescript)];
	}

	if (Array.isArray(existing)) {
		return [effect_preprocessor, ...existing];
	}

	return [effect_preprocessor, existing];
}

function create_effect_transform_preprocessor(transform_svelte_effect: TransformSvelteEffect) {
	return {
		name: "svelte-effect-runtime",
		markup: ({ content, filename }: { content: string; filename?: string }) => {
			const result = transform_svelte_effect(content, filename ?? "unknown.svelte", {
				target: "editor",
			});

			return { code: result.code };
		},
	};
}

function create_typescript_fallback_preprocessor(typescript: typeof import("typescript")) {
	return {
		name: "svelte-effect-runtime-language-server-ts-fallback",
		script: ({
			content,
			attributes,
			filename,
		}: {
			content: string;
			attributes: Record<string, string | boolean>;
			filename: string;
		}) => {
			if (attributes.lang !== "ts") {
				return;
			}

			const { outputText: output_text, sourceMapText: source_map_text } =
				typescript.transpileModule(content, {
					fileName: filename,
					compilerOptions: {
						module: typescript.ModuleKind.ESNext,
						target: typescript.ScriptTarget.ESNext,
						sourceMap: true,
						verbatimModuleSyntax: true,
					},
				});

			return {
				code: output_text,
				map: source_map_text,
				attributes: Object.fromEntries(
					Object.entries(attributes).filter(([key]) => key !== "lang" && key !== "type"),
				),
			};
		},
	};
}

function with_async_compiler_options(config: any) {
	const compiler_options = config?.compilerOptions ?? {};
	const experimental = compiler_options.experimental ?? {};

	return {
		...config,
		compilerOptions: {
			...compiler_options,
			experimental: {
				...experimental,
				async: true,
			},
		},
	};
}

function with_async_compile_options(options: any) {
	const experimental = options?.experimental ?? {};

	return {
		...options,
		experimental: {
			...experimental,
			async: true,
		},
	};
}

function contains_effect_preprocessor(preprocessors: any) {
	if (!preprocessors) {
		return false;
	}

	const list = Array.isArray(preprocessors) ? preprocessors : [preprocessors];
	return list.some((preprocessor) => preprocessor?.name === "svelte-effect-runtime");
}
