// deno-lint-ignore-file no-explicit-any
import {
  create_relocated_source_mapper,
  create_script_content_mapper,
  create_source_map_mapper,
  SequentialDocumentMapper,
} from "./document-mappers.ts";
import {
  safe_script_transform_result,
  safe_transform_result,
} from "./transform-results.ts";
import { Document, extractScriptTags } from "./svelte-internals.ts";
import type { Mapper, TransformSet } from "./types.ts";

import MagicString from "magic-string";

export function prepare_virtual_document(
  originalDocument: any,
  transforms: TransformSet,
) {
  const originalText = originalDocument.getText();
  const filename = originalDocument.getFilePath() ?? "Component.svelte";
  const sourceUri = originalDocument.uri;

  const markupResult = safe_transform_result(
    () =>
      transforms.transformEffectMarkup(originalText, {
        filename,
      }),
    originalText,
    filename,
  );

  let currentCode = markupResult.code;
  const markupCode = currentCode;
  let scriptMapper: Mapper | null = null;
  const scripts = extractScriptTags(currentCode);

  if (scripts?.script && has_own(scripts.script.attributes, "effect")) {
    const preScriptTransformCode = currentCode;
    const magicString = new MagicString(currentCode);
    const transformedScript = safe_script_transform_result(
      () =>
        transforms.transformEffectScript(
          scripts.script.content,
          { filename },
        ),
      scripts.script.content,
      filename,
    );

    if (transformedScript.code !== scripts.script.content) {
      magicString.overwrite(
        scripts.script.start,
        scripts.script.end,
        transformedScript.code,
      );
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

      if (transformedScriptTag) {
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
