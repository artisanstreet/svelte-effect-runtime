/** oxlint-disable no-explicit-any */
import {
	create_relocated_source_mapper,
	create_script_content_mapper,
	create_source_map_mapper,
	SequentialDocumentMapper,
} from "./document-mappers.ts";
import type { SvelteEffectSourceScan } from "../../../svelte-effect-runtime/src/compiler/source-scan.ts";
import { scan_svelte_effect_source } from "../../../svelte-effect-runtime/src/compiler/source-scan.ts";
import { safe_markup_transform_result, safe_script_transform_result } from "./transform-results.ts";
import { Document, extractScriptTags } from "./svelte-internals.ts";
import type { Mapper, TransformSet } from "./types.ts";

import MagicString from "magic-string";

export function prepare_virtual_document(originalDocument: any, transforms: TransformSet) {
	const originalText = originalDocument.getText();
	const filename = originalDocument.getFilePath() ?? "Component.svelte";
	const sourceUri = originalDocument.uri;
	const originalScan = scan_svelte_effect_source(originalText, filename);
	const normalizedDeclarations = normalize_bare_const_declaration_tags(
		originalText,
		sourceUri,
		originalScan,
	);
	const normalizationMapper = normalizedDeclarations
		? create_source_map_mapper(normalizedDeclarations.map, sourceUri)
		: null;
	const normalizedCode = normalizedDeclarations?.code ?? originalText;
	const normalizedScan = normalizedDeclarations
		? scan_svelte_effect_source(normalizedCode, filename)
		: originalScan;
	const globalTypescript = add_global_typescript_scripts(
		normalizedCode,
		sourceUri,
		normalizedScan,
	);
	const globalTypescriptMapper = globalTypescript
		? create_source_map_mapper(globalTypescript.map, sourceUri)
		: null;
	const baseCode = globalTypescript?.code ?? normalizedCode;

	const markup_attempt = safe_markup_transform_result(
		() =>
			transforms.transformEffectMarkup(baseCode, {
				filename,
			}),
		baseCode,
		filename,
	);
	const markupResult = markup_attempt.result;

	let currentCode = markupResult.code;
	const markupCode = currentCode;
	let scriptMapper: Mapper | null = null;
	const scripts = extractScriptTags(currentCode);

	if (scripts?.script && has_own(scripts.script.attributes, "effect")) {
		const preScriptTransformCode = currentCode;
		const magicString = new MagicString(currentCode);
		const transformed_script_attempt = safe_script_transform_result(
			() => transforms.transformEffectScript(scripts.script.content, { filename }),
			scripts.script.content,
			filename,
		);
		const transformedScript = transformed_script_attempt.result;
		const effectAttributeRange = find_effect_attribute_range(currentCode, scripts.script);
		const changedScriptContent = transformedScript.code !== scripts.script.content;

		if (effectAttributeRange) {
			magicString.remove(effectAttributeRange.start, effectAttributeRange.end);
		}

		if (changedScriptContent) {
			magicString.overwrite(scripts.script.start, scripts.script.end, transformedScript.code);
		}

		if (effectAttributeRange || changedScriptContent) {
			currentCode = magicString.toString();
			const fullDocumentMapper = create_source_map_mapper(
				magicString.generateMap({
					hires: true,
					includeContent: true,
					source: sourceUri,
				}) as unknown as Record<string, unknown>,
				sourceUri,
			);
			const transformedScripts = extractScriptTags(currentCode);
			const transformedScriptTag = transformedScripts?.script;

			if (changedScriptContent && transformedScriptTag) {
				scriptMapper = create_script_content_mapper(
					preScriptTransformCode,
					currentCode,
					scripts.script,
					transformedScriptTag,
					transformedScript.map,
					transformedScript.relocations ?? [],
					fullDocumentMapper,
					sourceUri,
				);
			} else {
				scriptMapper = fullDocumentMapper;
			}
		}
	}

	const markupMapper =
		markupResult.code === baseCode
			? null
			: create_relocated_source_mapper(
					baseCode,
					markupCode,
					markupResult.map,
					markupResult.relocations ?? [],
					sourceUri,
				);

	if (!scriptMapper && !markupMapper && !globalTypescriptMapper && !normalizationMapper) {
		return null;
	}

	const virtualDocument = Document.createForTest(sourceUri, currentCode);
	virtualDocument.version = originalDocument.version;
	virtualDocument.openedByClient = originalDocument.openedByClient;
	virtualDocument.config = originalDocument.config;
	virtualDocument.configPromise = originalDocument.configPromise;
	virtualDocument._compiler = originalDocument._compiler ?? originalDocument.compiler;
	virtualDocument.svelteVersion = originalDocument.svelteVersion;

	return {
		document: virtualDocument,
		preprocessMapper: new SequentialDocumentMapper(
			[scriptMapper, markupMapper, globalTypescriptMapper, normalizationMapper].filter(
				Boolean,
			) as Mapper[],
			sourceUri,
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
			hires: true,
			includeContent: true,
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
