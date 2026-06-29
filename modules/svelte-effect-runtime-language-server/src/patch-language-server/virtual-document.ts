// deno-lint-ignore-file no-explicit-any
import MagicString from "magic-string";

import { Document, extractScriptTags } from "./svelte-internals.ts";
import {
  create_relocated_source_mapper,
  create_script_content_mapper,
  create_source_map_mapper,
  SequentialDocumentMapper,
} from "./document-mappers.ts";
import type { Mapper, TransformSet } from "./types.ts";

export function prepare_virtual_document(
  originalDocument: any,
  transforms: TransformSet,
) {
  const originalText = originalDocument.getText();
  const filename = originalDocument.getFilePath() ?? "Component.svelte";
  const sourceUri = originalDocument.uri;

  const markupResult = transforms.transformEffectMarkup(originalText, {
    filename,
  });

  let currentCode = markupResult.code;
  const markupCode = currentCode;
  let scriptMapper: Mapper | null = null;
  const scripts = extractScriptTags(currentCode);

  if (scripts?.script && has_own(scripts.script.attributes, "effect")) {
    const preScriptTransformCode = currentCode;
    const magicString = new MagicString(currentCode);
    const transformedScript = transforms.transformEffectScript(
      scripts.script.content,
      { filename },
    );
    const effectAttributeRange = find_effect_attribute_range(
      currentCode,
      scripts.script,
    );
    const changedScriptContent =
      transformedScript.code !== scripts.script.content;

    if (effectAttributeRange) {
      magicString.remove(effectAttributeRange.start, effectAttributeRange.end);
    }

    if (changedScriptContent) {
      magicString.overwrite(
        scripts.script.start,
        scripts.script.end,
        transformedScript.code,
      );
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

  const markupMapper = markupResult.code === originalText
    ? null
    : create_relocated_source_mapper(
      originalText,
      markupCode,
      markupResult.map,
      markupResult.relocations ?? [],
      sourceUri,
    );

  if (!scriptMapper && !markupMapper) {
    return null;
  }

  const virtualDocument = Document.createForTest(sourceUri, currentCode);
  virtualDocument.version = originalDocument.version;
  virtualDocument.openedByClient = originalDocument.openedByClient;
  virtualDocument.config = originalDocument.config;
  virtualDocument.configPromise = originalDocument.configPromise;
  virtualDocument._compiler = originalDocument._compiler ??
    originalDocument.compiler;
  virtualDocument.svelteVersion = originalDocument.svelteVersion;

  return {
    document: virtualDocument,
    preprocessMapper: new SequentialDocumentMapper(
      [scriptMapper, markupMapper].filter(Boolean) as Mapper[],
      sourceUri,
    ),
  };
}

function has_own(object: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function find_effect_attribute_range(
  code: string,
  script: { container?: { start?: unknown }; start?: unknown },
): { start: number; end: number } | null {
  const container_start = script.container?.start;
  const content_start = script.start;

  if (
    typeof container_start !== "number" ||
    typeof content_start !== "number"
  ) {
    return null;
  }

  const opening_tag = code.slice(container_start, content_start);
  const match = /\s+effect(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/.exec(
    opening_tag,
  );

  if (!match) {
    return null;
  }

  return {
    start: container_start + match.index,
    end: container_start + match.index + match[0].length,
  };
}
