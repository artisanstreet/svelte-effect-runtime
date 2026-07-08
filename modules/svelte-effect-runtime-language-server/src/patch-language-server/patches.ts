/** oxlint-disable no-explicit-any */
import {
	CodeActionsProviderImpl,
	DocumentSnapshot,
	FallbackTranspiledSvelteDocument,
	patch_marker,
	SvelteDocument,
	TypeScriptSnapshotManagerModule,
	TypeScriptSvelteSysModule,
	TypeScriptSvelteUtils,
	TranspiledSvelteDocument,
	ts,
} from "./svelte-internals.ts";
import { is_invalid_position } from "./document-mappers.ts";
import { prepare_virtual_document } from "./virtual-document.ts";
import { rebind_snapshot_to_original_document } from "./snapshot.ts";
import type { TransformSet } from "./types.ts";

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

export function patch_svelte_file_extensions() {
	if (TypeScriptSvelteUtils[patch_marker]) {
		return;
	}

	TypeScriptSvelteUtils.isSvelteFilePath = is_svelte_file_path;
	TypeScriptSvelteUtils.isVirtualSvelteFilePath = is_virtual_svelte_file_path;
	TypeScriptSvelteUtils.toRealSvelteFilePath = to_real_svelte_file_path;
	TypeScriptSvelteUtils.toVirtualSvelteFilePath = to_virtual_svelte_file_path;
	TypeScriptSvelteUtils.ensureRealSvelteFilePath = ensure_real_svelte_file_path;
	TypeScriptSvelteUtils[patch_marker] = true;

	patch_svelte_sys_file_extensions();
	patch_snapshot_manager_file_extensions();
}

export function patch_svelte_compiler_path(transform_svelte_effect: TransformSvelteEffect) {
	const effect_preprocessor = create_effect_transform_preprocessor(transform_svelte_effect);

	patch_static_factory(TranspiledSvelteDocument, (originalCreate: any) => {
		return function create(this: unknown, document: unknown, config: any) {
			const preprocess = merge_preprocessors(config?.preprocess, effect_preprocessor);
			return originalCreate.call(
				this,
				document,
				with_async_compiler_options({
					...config,
					preprocess,
				}),
			);
		};
	});

	patch_static_factory(FallbackTranspiledSvelteDocument, (originalCreate: any) => {
		return function create(this: unknown, document: unknown, preprocessors: any[] = []) {
			return originalCreate.call(
				this,
				document,
				merge_preprocessors(preprocessors, effect_preprocessor),
			);
		};
	});

	patch_svelte_document_compile_options();
}

export function patch_typescript_snapshot_path(transforms: TransformSet) {
	const original_from_document = DocumentSnapshot.fromDocument;

	DocumentSnapshot.fromDocument = function fromDocument(
		this: unknown,
		document: any,
		options: any,
	) {
		const prepared = prepare_virtual_document(document, transforms);

		if (!prepared) {
			return original_from_document.call(this, document, options);
		}

		const snapshot = original_from_document.call(this, prepared.document, options);
		return rebind_snapshot_to_original_document(snapshot, document, prepared);
	};
	DocumentSnapshot.fromDocument[patch_marker] = true;

	DocumentSnapshot.fromSvelteFilePath = function fromSvelteFilePath(
		filePath: string,
		createDocument: (path: string, text: string) => any,
		options: any,
		tsSystem: { readFile(path: string): string | undefined },
	) {
		const original_text = tsSystem.readFile(filePath) ?? "";
		return DocumentSnapshot.fromDocument(createDocument(filePath, original_text), options);
	};
	DocumentSnapshot.fromSvelteFilePath[patch_marker] = true;
}

function patch_static_factory(target_class: any, makeReplacement: (originalCreate: any) => any) {
	if (target_class.create[patch_marker]) {
		return;
	}

	const original_create = target_class.create;
	target_class.create = makeReplacement(original_create);
	target_class.create[patch_marker] = true;
}

function patch_svelte_document_compile_options() {
	if (SvelteDocument.prototype.getCompiledWith?.[patch_marker]) {
		return;
	}

	const original_get_compiled_with = SvelteDocument.prototype.getCompiledWith;

	SvelteDocument.prototype.getCompiledWith = function getCompiledWith(
		this: unknown,
		options: any = {},
	) {
		return original_get_compiled_with.call(this, with_async_compile_options(options));
	};
	SvelteDocument.prototype.getCompiledWith[patch_marker] = true;
}

function patch_svelte_sys_file_extensions() {
	if (TypeScriptSvelteSysModule.createSvelteSys[patch_marker]) {
		return;
	}

	TypeScriptSvelteSysModule.createSvelteSys = function createSvelteSys(tsSystem: any) {
		return create_svelte_sys(tsSystem);
	};
	TypeScriptSvelteSysModule.createSvelteSys[patch_marker] = true;
}

function patch_snapshot_manager_file_extensions() {
	if (TypeScriptSnapshotManagerModule.SnapshotManager[patch_marker]) {
		return;
	}

	const OriginalSnapshotManager = TypeScriptSnapshotManagerModule.SnapshotManager;

	TypeScriptSnapshotManagerModule.SnapshotManager = class SnapshotManager extends (
		OriginalSnapshotManager
	) {
		constructor(...args: any[]) {
			super(...args);

			this.watchExtensions = with_svelte_file_extensions(this.watchExtensions);
		}
	};
	TypeScriptSnapshotManagerModule.SnapshotManager[patch_marker] = true;
}

function create_svelte_sys(tsSystem: any) {
	const file_exists_cache = create_file_exists_cache(tsSystem);

	function svelteFileExists(path: string) {
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

	function getRealSveltePathIfExists(path: string) {
		return svelteFileExists(path) ? to_real_svelte_file_path(path) : path;
	}

	const svelteSys = {
		...tsSystem,
		svelteFileExists,
		getRealSveltePathIfExists,
		fileExists(path: string) {
			if (svelteFileExists(path)) {
				return true;
			}

			return file_exists_cache.get(path);
		},
		readFile(path: string) {
			return tsSystem.readFile(getRealSveltePathIfExists(path));
		},
		readDirectory(
			path: string,
			extensions?: readonly string[],
			exclude?: readonly string[],
			include?: readonly string[],
			depth?: number,
		) {
			return tsSystem.readDirectory(
				path,
				with_svelte_file_extensions(extensions),
				exclude,
				include,
				depth,
			);
		},
		deleteFile(path: string) {
			delete_svelte_file_cache_entries(file_exists_cache, path);

			return tsSystem.deleteFile?.(path);
		},
		deleteFromCache(path: string) {
			delete_svelte_file_cache_entries(file_exists_cache, path);
		},
	};

	if (tsSystem.realpath) {
		const realpath = tsSystem.realpath;

		svelteSys.realpath = function realpath_svelte_file(path: string) {
			if (svelteFileExists(path)) {
				return realpath(to_real_svelte_file_path(path));
			}

			return realpath(path);
		};
	}

	return svelteSys;
}

function create_file_exists_cache(tsSystem: any) {
	const cache = new Map<string, boolean>();
	const get_key = (path: string) =>
		tsSystem.useCaseSensitiveFileNames ? path : path.toLowerCase();

	return {
		get(path: string) {
			const key = get_key(path);
			const cached = cache.get(key);

			if (cached !== undefined) {
				return cached;
			}

			const exists = tsSystem.fileExists(path);

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

export function patch_typescript_code_actions() {
	if (CodeActionsProviderImpl.prototype.applyQuickfix?.[patch_marker]) {
		return;
	}

	const original_apply_quickfix = CodeActionsProviderImpl.prototype.applyQuickfix;

	CodeActionsProviderImpl.prototype.applyQuickfix = async function applyQuickfix(
		document: any,
		range: { start: any; end: any },
		context: any,
		cancellationToken: any,
	) {
		const { tsDoc } = await this.getLSAndTSDoc(document);
		const generatedStart = tsDoc.getGeneratedPosition(range.start);
		const generatedEnd = tsDoc.getGeneratedPosition(range.end);

		if (is_invalid_position(generatedStart) || is_invalid_position(generatedEnd)) {
			return [];
		}

		const start = tsDoc.offsetAt(generatedStart);
		const end = tsDoc.offsetAt(generatedEnd);

		if (end < start) {
			return [];
		}

		return original_apply_quickfix.call(this, document, range, context, cancellationToken);
	};
	CodeActionsProviderImpl.prototype.applyQuickfix[patch_marker] = true;
}

function merge_preprocessors(existing: any, effect_preprocessor: any) {
	if (contains_effect_preprocessor(existing)) {
		return existing;
	}

	if (!existing) {
		return [effect_preprocessor, create_typescript_fallback_preprocessor()];
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

function create_typescript_fallback_preprocessor() {
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

			const { outputText, sourceMapText } = ts.transpileModule(content, {
				fileName: filename,
				compilerOptions: {
					module: ts.ModuleKind.ESNext,
					target: ts.ScriptTarget.ESNext,
					sourceMap: true,
					verbatimModuleSyntax: true,
				},
			});

			return {
				code: outputText,
				map: sourceMapText,
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
