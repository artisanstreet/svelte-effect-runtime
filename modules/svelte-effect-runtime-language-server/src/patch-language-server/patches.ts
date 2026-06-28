// deno-lint-ignore-file no-explicit-any
import {
  CodeActionsProviderImpl,
  DocumentSnapshot,
  FallbackTranspiledSvelteDocument,
  patch_marker,
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

export function patch_svelte_compiler_path(
  transform_svelte_effect: TransformSvelteEffect,
) {
  const effect_preprocessor = create_effect_transform_preprocessor(
    transform_svelte_effect,
  );

  patch_static_factory(TranspiledSvelteDocument, (originalCreate: any) => {
    return function create(this: unknown, document: unknown, config: any) {
      const preprocess = merge_preprocessors(
        config?.preprocess,
        effect_preprocessor,
      );
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
          merge_preprocessors(preprocessors, effect_preprocessor),
        );
      };
    },
  );
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

export function patch_typescript_code_actions() {
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

function create_effect_transform_preprocessor(
  transform_svelte_effect: TransformSvelteEffect,
) {
  return {
    name: "svelte-effect-runtime",
    markup: ({ content, filename }: {
      content: string;
      filename?: string;
    }) => {
      const result = transform_svelte_effect(
        content,
        filename ?? "unknown.svelte",
        { target: "editor" },
      );

      return { code: result.code };
    },
  };
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

function contains_effect_preprocessor(preprocessors: any) {
  if (!preprocessors) {
    return false;
  }

  const list = Array.isArray(preprocessors) ? preprocessors : [preprocessors];
  return list.some((preprocessor) =>
    preprocessor?.name === "svelte-effect-runtime"
  );
}
