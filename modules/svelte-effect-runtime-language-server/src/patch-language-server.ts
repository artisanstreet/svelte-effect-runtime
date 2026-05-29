// deno-lint-ignore-file no-explicit-any
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import MagicString from "magic-string";
import { TraceMap } from "@jridgewell/trace-mapping";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");
const patch_marker = Symbol.for("svelte-effect-runtime.language-server.patch");
const package_root = resolve_package_root(
  path.dirname(fileURLToPath(import.meta.url)),
);
const runtime_import_root = resolve_runtime_import_root(package_root);
const language_server_root = path.join(
  path.dirname(require.resolve("svelte-language-server/package.json")),
  "dist",
  "src",
);

const { Document } = require(path.join(
  language_server_root,
  "lib",
  "documents",
  "Document.js",
)) as { Document: any };
const { FragmentMapper, SourceMapDocumentMapper } = require(path.join(
  language_server_root,
  "lib",
  "documents",
  "DocumentMapper.js",
)) as { FragmentMapper: any; SourceMapDocumentMapper: any };
const { extractScriptTags } = require(path.join(
  language_server_root,
  "lib",
  "documents",
  "utils.js",
)) as { extractScriptTags: (code: string) => any };
const { DocumentSnapshot } = require(path.join(
  language_server_root,
  "plugins",
  "typescript",
  "DocumentSnapshot.js",
)) as { DocumentSnapshot: any };
const { CodeActionsProviderImpl } = require(path.join(
  language_server_root,
  "plugins",
  "typescript",
  "features",
  "CodeActionsProvider.js",
)) as { CodeActionsProviderImpl: any };
const {
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

type Mapper = {
  getOriginalPosition(position: any): any;
  getGeneratedPosition(position: any): any;
  isInGenerated(position: any): boolean;
};

type Relocation = {
  originalStart: number;
  originalEnd: number;
  generatedStart: number;
  generatedEnd: number;
};

function is_invalid_position(position: any) {
  return position.line < 0 || position.character < 0;
}

export async function bootstrap_language_server() {
  if (DocumentSnapshot.fromDocument[patch_marker]) {
    return;
  }

  const runtime_module = await import_runtime_module("runtime/preprocess.js");

  patch_svelte_compiler_path(runtime_module.preprocess);
  patch_typescript_snapshot_path({
    transformEffectMarkup: (code, options) =>
      normalize_transform_result(
        runtime_module.transform_markup_effect(code, options.filename),
        code,
        options.filename,
      ),
    transformEffectScript: (code, options) =>
      normalize_transform_result(
        runtime_module.transform_script_effect(code, options.filename),
        code,
        options.filename,
      ),
  });
  patch_typescript_code_actions();
}

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
      path.join(workspace_runtime_source_root, "runtime", "preprocess.ts"),
    )
  ) {
    return workspace_runtime_source_root;
  }

  if (existsSync(workspace_runtime_root)) {
    return workspace_runtime_root;
  }

  return package_root;
}

function import_runtime_module(relative_path: string) {
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

function normalize_transform_result(
  result: {
    code: string;
    map?: Record<string, unknown>;
    relocations?: Array<Relocation>;
  },
  original_code: string,
  filename: string,
) {
  return {
    ...result,
    map: result.map ?? create_identity_source_map(original_code, filename),
  };
}

function create_identity_source_map(
  code: string,
  filename: string,
): Record<string, unknown> {
  const magic = new MagicString(code);

  return magic.generateMap({
    hires: true,
    includeContent: true,
    source: filename,
  }) as unknown as Record<string, unknown>;
}

function patch_svelte_compiler_path(effectPreprocess: () => any) {
  patch_static_factory(TranspiledSvelteDocument, (originalCreate: any) => {
    return function create(this: unknown, document: unknown, config: any) {
      const preprocess = merge_preprocessors(
        config?.preprocess,
        effectPreprocess,
      );
      return originalCreate.call(this, document, {
        ...config,
        preprocess,
      });
    };
  });

  patch_static_factory(
    FallbackTranspiledSvelteDocument,
    (originalCreate: any) => {
      return function create(
        this: unknown,
        document: unknown,
        preprocessors: any[] = [],
      ) {
        return originalCreate.call(
          this,
          document,
          merge_preprocessors(preprocessors, effectPreprocess),
        );
      };
    },
  );
}

function patch_typescript_snapshot_path(
  transforms: {
    transformEffectMarkup: (code: string, options: { filename: string }) => {
      code: string;
      map: Record<string, unknown>;
      relocations?: Array<Relocation>;
    };
    transformEffectScript: (code: string, options: { filename: string }) => {
      code: string;
      map: Record<string, unknown>;
      relocations?: Array<Relocation>;
    };
  },
) {
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

    const snapshot = original_from_document.call(
      this,
      prepared.document,
      options,
    );
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
    return DocumentSnapshot.fromDocument(
      createDocument(filePath, original_text),
      options,
    );
  };
  DocumentSnapshot.fromSvelteFilePath[patch_marker] = true;
}

function patch_static_factory(
  target_class: any,
  makeReplacement: (originalCreate: any) => any,
) {
  if (target_class.create[patch_marker]) {
    return;
  }

  const original_create = target_class.create;
  target_class.create = makeReplacement(original_create);
  target_class.create[patch_marker] = true;
}

function patch_typescript_code_actions() {
  if (CodeActionsProviderImpl.prototype.applyQuickfix?.[patch_marker]) {
    return;
  }

  const original_apply_quickfix =
    CodeActionsProviderImpl.prototype.applyQuickfix;

  CodeActionsProviderImpl.prototype.applyQuickfix =
    async function applyQuickfix(
      document: any,
      range: { start: any; end: any },
      context: any,
      cancellationToken: any,
    ) {
      const { tsDoc } = await this.getLSAndTSDoc(document);
      const generatedStart = tsDoc.getGeneratedPosition(range.start);
      const generatedEnd = tsDoc.getGeneratedPosition(range.end);

      if (
        is_invalid_position(generatedStart) ||
        is_invalid_position(generatedEnd)
      ) {
        return [];
      }

      const start = tsDoc.offsetAt(generatedStart);
      const end = tsDoc.offsetAt(generatedEnd);

      if (end < start) {
        return [];
      }

      return original_apply_quickfix.call(
        this,
        document,
        range,
        context,
        cancellationToken,
      );
    };
  CodeActionsProviderImpl.prototype.applyQuickfix[patch_marker] = true;
}

function merge_preprocessors(existing: any, effectPreprocess: () => any) {
  if (contains_effect_preprocessor(existing)) {
    return existing;
  }

  const next = effectPreprocess();

  if (!existing) {
    return [next, create_typescript_fallback_preprocessor()];
  }

  if (Array.isArray(existing)) {
    return [next, ...existing];
  }

  return [next, existing];
}

function create_typescript_fallback_preprocessor() {
  return {
    name: "svelte-effect-runtime-language-server-ts-fallback",
    script: ({ content, attributes, filename }: {
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
        attributes: {
          ...Object.fromEntries(
            Object.entries(attributes).filter(([key]) =>
              key !== "lang" && key !== "type"
            ),
          ),
        },
      };
    },
  };
}

function contains_effect_preprocessor(preprocessors: any) {
  if (!preprocessors) {
    return false;
  }

  const list = Array.isArray(preprocessors) ? preprocessors : [preprocessors];
  return list.some((preprocessor) =>
    preprocessor?.name === "svelte-effect-runtime"
  );
}

function prepare_virtual_document(
  originalDocument: any,
  transforms: {
    transformEffectMarkup: (code: string, options: { filename: string }) => {
      code: string;
      map: Record<string, unknown>;
      relocations?: Array<Relocation>;
    };
    transformEffectScript: (code: string, options: { filename: string }) => {
      code: string;
      map: Record<string, unknown>;
      relocations?: Array<Relocation>;
    };
  },
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

function create_source_map_mapper(
  rawMap: Record<string, unknown>,
  sourceUri: string,
) {
  return new SourceMapDocumentMapper(
    new TraceMap({
      ...(rawMap as any),
      sources: [sourceUri],
    } as any),
    sourceUri,
  ) as Mapper;
}

function create_relocated_source_mapper(
  originalCode: string,
  transformedCode: string,
  rawMap: Record<string, unknown>,
  relocations: Array<Relocation>,
  sourceUri: string,
): Mapper {
  const sourceMapper = create_source_map_mapper(rawMap, sourceUri);
  const relocationMapper = create_relocation_mapper(
    originalCode,
    transformedCode,
    relocations,
  );

  if (!relocationMapper) {
    return sourceMapper;
  }

  return {
    getOriginalPosition(generatedPosition: any) {
      const relocatedPosition = relocationMapper.getOriginalPosition(
        generatedPosition,
      );

      if (!is_invalid_position(relocatedPosition)) {
        return relocatedPosition;
      }

      return sourceMapper.getOriginalPosition(generatedPosition);
    },
    getGeneratedPosition(originalPosition: any) {
      const relocatedPosition = relocationMapper.getGeneratedPosition(
        originalPosition,
      );

      if (!is_invalid_position(relocatedPosition)) {
        return relocatedPosition;
      }

      return sourceMapper.getGeneratedPosition(originalPosition);
    },
    isInGenerated(originalPosition: any) {
      const generatedPosition = this.getGeneratedPosition(originalPosition);
      return !is_invalid_position(generatedPosition);
    },
  };
}

function create_script_content_mapper(
  originalCode: string,
  transformedCode: string,
  originalTagInfo: any,
  transformedTagInfo: any,
  rawMap: Record<string, unknown>,
  relocations: Array<Relocation>,
  fullDocumentMapper: Mapper,
  sourceUri: string,
): Mapper {
  const originalFragmentMapper = new FragmentMapper(
    originalCode,
    originalTagInfo,
    sourceUri,
  ) as Mapper;
  const transformedFragmentMapper = new FragmentMapper(
    transformedCode,
    transformedTagInfo,
    sourceUri,
  ) as Mapper;
  const sourceMapper = create_source_map_mapper(rawMap, sourceUri);
  const relocationMapper = create_relocation_mapper(
    originalTagInfo.content,
    transformedTagInfo.content,
    relocations,
  );

  return {
    getOriginalPosition(generatedPosition: any) {
      if (!transformedFragmentMapper.isInGenerated(generatedPosition)) {
        return fullDocumentMapper.getOriginalPosition(generatedPosition);
      }

      const positionInTransformedFragment = transformedFragmentMapper
        .getGeneratedPosition(generatedPosition);

      if (is_invalid_position(positionInTransformedFragment)) {
        return positionInTransformedFragment;
      }

      const relocatedOriginalPosition = relocationMapper?.getOriginalPosition(
        positionInTransformedFragment,
      );

      if (
        relocatedOriginalPosition &&
        !is_invalid_position(relocatedOriginalPosition)
      ) {
        return originalFragmentMapper.getOriginalPosition(
          relocatedOriginalPosition,
        );
      }

      const positionInOriginalFragment = sourceMapper.getOriginalPosition(
        positionInTransformedFragment,
      );

      if (is_invalid_position(positionInOriginalFragment)) {
        return positionInOriginalFragment;
      }

      return originalFragmentMapper.getOriginalPosition(
        positionInOriginalFragment,
      );
    },
    getGeneratedPosition(originalPosition: any) {
      if (!originalFragmentMapper.isInGenerated(originalPosition)) {
        return fullDocumentMapper.getGeneratedPosition(originalPosition);
      }

      const positionInOriginalFragment = originalFragmentMapper
        .getGeneratedPosition(originalPosition);

      if (is_invalid_position(positionInOriginalFragment)) {
        return positionInOriginalFragment;
      }

      const relocatedGeneratedPosition = relocationMapper?.getGeneratedPosition(
        positionInOriginalFragment,
      );

      if (
        relocatedGeneratedPosition &&
        !is_invalid_position(relocatedGeneratedPosition)
      ) {
        return transformedFragmentMapper.getOriginalPosition(
          relocatedGeneratedPosition,
        );
      }

      const positionInTransformedFragment = sourceMapper.getGeneratedPosition(
        positionInOriginalFragment,
      );

      if (is_invalid_position(positionInTransformedFragment)) {
        return positionInTransformedFragment;
      }

      return transformedFragmentMapper.getOriginalPosition(
        positionInTransformedFragment,
      );
    },
    isInGenerated(originalPosition: any) {
      const generatedPosition = this.getGeneratedPosition(originalPosition);
      return !is_invalid_position(generatedPosition);
    },
  };
}

function create_relocation_mapper(
  originalContent: string,
  transformedContent: string,
  relocations: Array<Relocation>,
): Mapper | null {
  if (relocations.length === 0) {
    return null;
  }

  const originalOffsets = new OffsetTable(originalContent);
  const transformedOffsets = new OffsetTable(transformedContent);

  return {
    getOriginalPosition(generatedPosition: any) {
      const generatedOffset = transformedOffsets.offsetAt(generatedPosition);
      const relocation = find_relocation(
        relocations,
        generatedOffset,
        "generatedStart",
        "generatedEnd",
      );

      if (!relocation) {
        return { line: -1, character: -1 };
      }

      return originalOffsets.positionAt(
        map_offset_between_ranges(
          generatedOffset,
          relocation.generatedStart,
          relocation.generatedEnd,
          relocation.originalStart,
          relocation.originalEnd,
        ),
      );
    },
    getGeneratedPosition(originalPosition: any) {
      const originalOffset = originalOffsets.offsetAt(originalPosition);
      const relocation = find_relocation(
        relocations,
        originalOffset,
        "originalStart",
        "originalEnd",
      );

      if (!relocation) {
        return { line: -1, character: -1 };
      }

      return transformedOffsets.positionAt(
        map_offset_between_ranges(
          originalOffset,
          relocation.originalStart,
          relocation.originalEnd,
          relocation.generatedStart,
          relocation.generatedEnd,
        ),
      );
    },
    isInGenerated(originalPosition: any) {
      return !is_invalid_position(this.getGeneratedPosition(originalPosition));
    },
  };
}

function find_relocation(
  relocations: Array<Relocation>,
  offset: number,
  startKey: "originalStart" | "generatedStart",
  endKey: "originalEnd" | "generatedEnd",
) {
  let match: Relocation | null = null;

  for (const relocation of relocations) {
    if (offset < relocation[startKey] || offset > relocation[endKey]) {
      continue;
    }

    if (
      !match ||
      relocation[endKey] - relocation[startKey] <
        match[endKey] - match[startKey]
    ) {
      match = relocation;
    }
  }

  return match;
}

function map_offset_between_ranges(
  offset: number,
  sourceStart: number,
  sourceEnd: number,
  targetStart: number,
  targetEnd: number,
) {
  if (offset <= sourceStart) {
    return targetStart;
  }

  if (offset >= sourceEnd) {
    return targetEnd;
  }

  const sourceLength = Math.max(sourceEnd - sourceStart, 1);
  const targetLength = Math.max(targetEnd - targetStart, 1);
  const relativeOffset = Math.min(
    Math.max(offset - sourceStart, 0),
    sourceLength - 1,
  );

  return targetStart + Math.min(relativeOffset, targetLength - 1);
}

class OffsetTable {
  private readonly lineStarts: number[];

  constructor(text: string) {
    this.lineStarts = [0];

    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10) {
        this.lineStarts.push(index + 1);
      }
    }
  }

  offsetAt(position: { line: number; character: number }) {
    if (position.line < 0 || position.line >= this.lineStarts.length) {
      return -1;
    }

    return this.lineStarts[position.line] + position.character;
  }

  positionAt(offset: number) {
    if (offset < 0) {
      return { line: -1, character: -1 };
    }

    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const lineStart = this.lineStarts[middle];
      const nextLineStart = this.lineStarts[middle + 1] ??
        Number.POSITIVE_INFINITY;

      if (offset < lineStart) {
        high = middle - 1;
        continue;
      }

      if (offset >= nextLineStart) {
        low = middle + 1;
        continue;
      }

      return {
        line: middle,
        character: offset - lineStart,
      };
    }

    return { line: -1, character: -1 };
  }
}

function rebind_snapshot_to_original_document(
  snapshot: any,
  originalDocument: any,
  prepared: { document: any; preprocessMapper: Mapper },
) {
  const innerMapper = snapshot.getMapper();
  snapshot.mapper = new SnapshotDocumentMapper(
    innerMapper,
    prepared.preprocessMapper,
    originalDocument.uri,
  );

  if (snapshot.parserError) {
    snapshot.parserError = {
      ...snapshot.parserError,
      range: map_range(prepared.preprocessMapper, snapshot.parserError.range),
    };
  }

  if (snapshot.htmlAst) {
    snapshot.htmlAst = clone_ast_with_original_offsets(
      snapshot.htmlAst,
      prepared.document,
      originalDocument,
      prepared.preprocessMapper,
    );
  }

  snapshot.parent = originalDocument;
  snapshot.version = originalDocument.version;
  return snapshot;
}

function map_range(mapper: Mapper, range: { start: any; end: any }) {
  return {
    start: mapper.getOriginalPosition(range.start),
    end: mapper.getOriginalPosition(range.end),
  };
}

function clone_ast_with_original_offsets(
  value: any,
  preprocessedDocument: any,
  originalDocument: any,
  preprocessMapper: Mapper,
  seen = new WeakMap<object, any>(),
): any {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const clone: any[] = [];
    seen.set(value, clone);
    for (const item of value) {
      clone.push(
        clone_ast_with_original_offsets(
          item,
          preprocessedDocument,
          originalDocument,
          preprocessMapper,
          seen,
        ),
      );
    }
    return clone;
  }

  const clone = Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone);

  for (const [key, child] of Object.entries(value)) {
    if ((key === "start" || key === "end") && typeof child === "number") {
      clone[key] = map_offset_to_original(
        child,
        preprocessedDocument,
        originalDocument,
        preprocessMapper,
      );
      continue;
    }

    clone[key] = clone_ast_with_original_offsets(
      child,
      preprocessedDocument,
      originalDocument,
      preprocessMapper,
      seen,
    );
  }

  return clone;
}

function map_offset_to_original(
  offset: number,
  preprocessedDocument: any,
  originalDocument: any,
  preprocessMapper: Mapper,
) {
  const originalPosition = preprocessMapper.getOriginalPosition(
    preprocessedDocument.positionAt(offset),
  );

  if (is_invalid_position(originalPosition)) {
    return offset;
  }

  return originalDocument.offsetAt(originalPosition);
}

class SequentialDocumentMapper {
  constructor(
    private readonly mappers: Mapper[],
    private readonly url: string,
  ) {}

  getOriginalPosition(generatedPosition: any) {
    return this.mappers.reduce((position, mapper) => {
      if (is_invalid_position(position)) {
        return position;
      }

      return mapper.getOriginalPosition(position);
    }, generatedPosition);
  }

  getGeneratedPosition(originalPosition: any) {
    return [...this.mappers].reverse().reduce((position, mapper) => {
      if (is_invalid_position(position)) {
        return position;
      }

      return mapper.getGeneratedPosition(position);
    }, originalPosition);
  }

  isInGenerated(originalPosition: any) {
    const generatedPosition = this.getGeneratedPosition(originalPosition);
    return generatedPosition.line >= 0 && generatedPosition.character >= 0;
  }

  getURL() {
    return this.url;
  }
}

class SnapshotDocumentMapper {
  constructor(
    private readonly innerMapper: Mapper,
    private readonly preprocessMapper: Mapper,
    private readonly url: string,
  ) {}

  getOriginalPosition(generatedPosition: any) {
    return this.preprocessMapper.getOriginalPosition(
      this.innerMapper.getOriginalPosition(generatedPosition),
    );
  }

  getGeneratedPosition(originalPosition: any) {
    const preprocessedPosition = this.preprocessMapper.getGeneratedPosition(
      originalPosition,
    );

    if (is_invalid_position(preprocessedPosition)) {
      return preprocessedPosition;
    }

    return this.innerMapper.getGeneratedPosition(preprocessedPosition);
  }

  isInGenerated(originalPosition: any) {
    const preprocessedPosition = this.preprocessMapper.getGeneratedPosition(
      originalPosition,
    );

    if (is_invalid_position(preprocessedPosition)) {
      return false;
    }

    return this.innerMapper.isInGenerated(preprocessedPosition);
  }

  getURL() {
    return this.url;
  }
}
