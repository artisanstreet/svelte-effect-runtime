/** oxlint-disable no-explicit-any */
import {
	create_relocated_source_mapper,
	create_script_content_mapper,
	create_source_map_mapper,
	SequentialDocumentMapper,
} from "./document-mappers.ts";
import {
	scan_svelte_effect_source,
	shift_scan_after_at_insertions,
} from "../../../svelte-effect-runtime/src/compiler/source-scan.ts";
import type { SvelteEffectSourceScan } from "../../../svelte-effect-runtime/src/compiler/source-scan.ts";
import { safe_markup_transform_result, safe_script_transform_result } from "./transform-results.ts";
import type { SvelteInternalsService } from "./svelte-internals.ts";
import type { Mapper, TransformSet } from "./types.ts";

import MagicString from "magic-string";

/**
 * Prepares a transformed virtual Svelte document while retaining mappings back
 * to the original source document.
 *
 * @example
 * ```ts
 * const prepared = prepare_virtual_document(document, transforms, internals);
 *
 * if (prepared) {
 * 	consume_snapshot(prepared.document, prepared.preprocessMapper);
 * }
 * ```
 *
 * @since 2.0.0
 * @param original_document - Source document supplied by the Svelte language
 *   server and used as the mapping destination.
 * @param transforms - SER markup and script transforms used to build the
 *   language server's virtual source.
 * @param internals - Private Svelte language-server modules loaded during
 *   bootstrap and captured by the synchronous snapshot callback.
 * @returns The transformed document and its mapper, or `null` when no virtual
 *   transformation was required.
 */
export function prepare_virtual_document(
	original_document: any,
	transforms: TransformSet,
	internals: SvelteInternalsService,
) {
	const original_text = original_document.getText();
	const filename = original_document.getFilePath() ?? "Component.svelte";
	const source_uri = original_document.uri;
	const original_scan = scan_svelte_effect_source(original_text, filename);
	const normalized_declarations = normalize_bare_const_declaration_tags(
		original_text,
		source_uri,
		original_scan,
	);
	const normalization_mapper = normalized_declarations
		? create_source_map_mapper(
				normalized_declarations.map,
				source_uri,
				internals.source_map_document_mapper,
			)
		: null;
	const normalized_code = normalized_declarations?.code ?? original_text;
	const normalized_scan = normalized_declarations
		? shift_scan_after_at_insertions(
				original_scan,
				normalized_code,
				original_scan.bare_const_tags.map((tag) => tag.insert_position),
			)
		: original_scan;
	const global_typescript = add_global_typescript_scripts(
		normalized_code,
		source_uri,
		normalized_scan,
	);
	const global_typescript_mapper = global_typescript
		? create_source_map_mapper(
				global_typescript.map,
				source_uri,
				internals.source_map_document_mapper,
			)
		: null;
	const base_code = global_typescript?.code ?? normalized_code;

	const markup_attempt = safe_markup_transform_result(
		() =>
			transforms.transformEffectMarkup(base_code, {
				filename,
			}),
		base_code,
		filename,
	);
	const markup_result = markup_attempt.result;

	let current_code = markup_result.code;
	const markup_code = current_code;
	let script_mapper: Mapper | null = null;
	const scripts = internals.extract_script_tags(current_code);

	if (scripts?.script && has_own(scripts.script.attributes, "effect")) {
		const pre_script_transform_code = current_code;
		const magic_string = new MagicString(current_code);
		const transformed_script_attempt = safe_script_transform_result(
			() => transforms.transformEffectScript(scripts.script.content, { filename }),
			scripts.script.content,
			filename,
		);
		const transformed_script = transformed_script_attempt.result;
		const effect_attribute_range = find_effect_attribute_range(current_code, scripts.script);
		const changed_script_content = transformed_script.code !== scripts.script.content;

		if (effect_attribute_range) {
			magic_string.remove(effect_attribute_range.start, effect_attribute_range.end);
		}

		if (changed_script_content) {
			magic_string.overwrite(
				scripts.script.start,
				scripts.script.end,
				transformed_script.code,
			);
		}

		if (effect_attribute_range || changed_script_content) {
			current_code = magic_string.toString();
			const full_document_mapper = create_source_map_mapper(
				magic_string.generateMap({
					hires: true,
					includeContent: true,
					source: source_uri,
				}) as unknown as Record<string, unknown>,
				source_uri,
				internals.source_map_document_mapper,
			);
			const transformed_scripts = internals.extract_script_tags(current_code);
			const transformed_script_tag = transformed_scripts?.script;

			if (changed_script_content && transformed_script_tag) {
				script_mapper = create_script_content_mapper(
					pre_script_transform_code,
					current_code,
					scripts.script,
					transformed_script_tag,
					transformed_script.map,
					transformed_script.relocations ?? [],
					full_document_mapper,
					source_uri,
					internals,
				);
			} else {
				script_mapper = full_document_mapper;
			}
		}
	}

	const markup_mapper =
		markup_result.code === base_code
			? null
			: create_relocated_source_mapper(
					base_code,
					markup_code,
					markup_result.map,
					markup_result.relocations ?? [],
					source_uri,
					internals,
				);

	if (!script_mapper && !markup_mapper && !global_typescript_mapper && !normalization_mapper) {
		return null;
	}

	const virtual_document = internals.document.createForTest(source_uri, current_code);
	virtual_document.version = original_document.version;
	virtual_document.openedByClient = original_document.openedByClient;
	virtual_document.config = original_document.config;
	virtual_document.configPromise = original_document.configPromise;
	virtual_document._compiler = original_document._compiler ?? original_document.compiler;
	virtual_document.svelteVersion = original_document.svelteVersion;

	return {
		document: virtual_document,
		preprocessMapper: new SequentialDocumentMapper(
			[script_mapper, markup_mapper, global_typescript_mapper, normalization_mapper].filter(
				Boolean,
			) as Mapper[],
			source_uri,
		),
	};
}

function add_global_typescript_scripts(
	code: string,
	source_uri: string,
	scan: SvelteEffectSourceScan,
): { code: string; map: Record<string, unknown> } | null {
	const magic = new MagicString(code);
	let changed = false;

	for (const script of scan.scripts) {
		if (script.has_lang) {
			continue;
		}

		magic.appendLeft(script.tag_name_end, ' lang="ts"');
		changed = true;
	}

	if (scan.scripts.length === 0) {
		magic.prepend('<script lang="ts"></script>\n');
		changed = true;
	}

	if (!changed) {
		return null;
	}

	return {
		code: magic.toString(),
		map: magic.generateMap({
			hires: true,
			includeContent: true,
			source: source_uri,
		}) as unknown as Record<string, unknown>,
	};
}

function has_own(object: object, key: PropertyKey) {
	return Object.prototype.hasOwnProperty.call(object, key);
}

function normalize_bare_const_declaration_tags(
	code: string,
	source_uri: string,
	scan: SvelteEffectSourceScan,
): { code: string; map: Record<string, unknown> } | null {
	const magic = new MagicString(code);
	let changed = false;

	for (const tag of scan.bare_const_tags) {
		magic.appendRight(tag.insert_position, "@");
		changed = true;
	}

	if (!changed) {
		return null;
	}

	return {
		code: magic.toString(),
		map: magic.generateMap({
			hires: false,
			includeContent: false,
			source: source_uri,
		}) as unknown as Record<string, unknown>,
	};
}

function find_effect_attribute_range(
	code: string,
	script: { container?: { start?: unknown }; start?: unknown },
): { start: number; end: number } | null {
	const container_start = script.container?.start;
	const content_start = script.start;

	if (typeof container_start !== "number" || typeof content_start !== "number") {
		return null;
	}

	const scan = scan_svelte_effect_source(code);
	const script_region = scan.scripts.find(
		(region) =>
			region.opening_tag_start === container_start && region.content_start === content_start,
	);

	return script_region?.effect_attribute ?? null;
}
