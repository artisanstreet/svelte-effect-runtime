/** oxlint-disable no-explicit-any */
import {
	create_relocated_source_mapper,
	create_script_content_mapper,
	create_source_map_mapper,
	SequentialDocumentMapper,
} from "./document-mappers.ts";
import { safe_markup_transform_result, safe_script_transform_result } from "./transform-results.ts";
import { Document, extractScriptTags } from "./svelte-internals.ts";
import type { Mapper, TransformSet } from "./types.ts";

import MagicString from "magic-string";

export function prepare_virtual_document(originalDocument: any, transforms: TransformSet) {
	const originalText = originalDocument.getText();
	const filename = originalDocument.getFilePath() ?? "Component.svelte";
	const sourceUri = originalDocument.uri;
	const normalizedDeclarations = normalize_bare_const_declaration_tags(originalText, sourceUri);
	const normalizationMapper = normalizedDeclarations
		? create_source_map_mapper(normalizedDeclarations.map, sourceUri)
		: null;
	const normalizedCode = normalizedDeclarations?.code ?? originalText;
	const globalTypescript = add_global_typescript_scripts(normalizedCode, sourceUri);
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
): { code: string; map: Record<string, unknown> } | null {
	const tags = find_script_open_tags(code);
	const magic = new MagicString(code);

	let changed = false;

	for (const tag of tags) {
		if (tag.has_lang) {
			continue;
		}

		magic.appendLeft(tag.insert_position, ' lang="ts"');
		changed = true;
	}

	if (tags.length === 0) {
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

function find_script_open_tags(
	source: string,
): Array<{ has_lang: boolean; insert_position: number }> {
	const lower_source = source.toLowerCase();
	const tags: Array<{ has_lang: boolean; insert_position: number }> = [];

	let index = 0;

	while (index < source.length) {
		const script_start = find_next_script_start(lower_source, index);

		if (script_start === -1) {
			break;
		}

		const tag_end = find_tag_end_from(source, script_start);

		if (tag_end === -1) {
			break;
		}

		const tag = source.slice(script_start, tag_end + 1);

		tags.push({
			has_lang: tag_has_lang_attribute(tag),
			insert_position: script_start + "<script".length,
		});

		index = tag_end + 1;
	}

	return tags;
}

function find_next_script_start(lower_source: string, start: number): number {
	let index = start;

	while (index < lower_source.length) {
		const script_start = lower_source.indexOf("<script", index);

		if (script_start === -1) {
			return -1;
		}

		const boundary = lower_source[script_start + "<script".length];

		if (boundary === undefined || boundary === ">" || boundary === "/" || /\s/.test(boundary)) {
			return script_start;
		}

		index = script_start + "<script".length;
	}

	return -1;
}

function find_tag_end_from(source: string, start: number): number {
	let quote: string | undefined;

	for (let index = start; index < source.length; index += 1) {
		const char = source[index];

		if (quote) {
			if (char === quote) {
				quote = undefined;
			}

			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}

		if (char === ">") {
			return index;
		}
	}

	return -1;
}

function tag_has_lang_attribute(tag: string): boolean {
	return /\slang(?:\s*=|\s|>|\/)/i.test(tag);
}

function has_own(object: object, key: PropertyKey) {
	return Object.prototype.hasOwnProperty.call(object, key);
}

function normalize_bare_const_declaration_tags(
	code: string,
	source_uri: string,
): { code: string; map: Record<string, unknown> } | null {
	const magic = new MagicString(code);
	let changed = false;
	let cursor = 0;

	while (cursor < code.length) {
		const open = code.indexOf("{", cursor);

		if (open === -1) {
			break;
		}

		if (is_inside_excluded_block(code, open) || is_inside_html_comment(code, open)) {
			cursor = open + 1;
			continue;
		}

		const match = /^(\s*)const\s/.exec(code.slice(open + 1));

		if (!match) {
			cursor = open + 1;
			continue;
		}

		magic.appendRight(open + 1, "@");
		changed = true;
		cursor = open + 1 + match[0].length;
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

function is_inside_excluded_block(content: string, pos: number): boolean {
	const script = find_tag_end(content, "script", pos);
	const style = find_tag_end(content, "style", pos);

	return script > pos || style > pos;
}

function is_inside_html_comment(content: string, pos: number): boolean {
	const open = content.lastIndexOf("<!--", pos);
	const close = content.lastIndexOf("-->", pos);

	return open > close;
}

function find_tag_end(content: string, tag: "script" | "style", pos: number): number {
	const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");

	for (const match of content.matchAll(pattern)) {
		const start = match.index ?? -1;
		const end = start + match[0].length;

		if (start <= pos && pos < end) {
			return end;
		}
	}

	return -1;
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

	const opening_tag = code.slice(container_start, content_start);
	const match = /\s+effect(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/.exec(opening_tag);

	if (!match) {
		return null;
	}

	return {
		start: container_start + match.index,
		end: container_start + match.index + match[0].length,
	};
}
