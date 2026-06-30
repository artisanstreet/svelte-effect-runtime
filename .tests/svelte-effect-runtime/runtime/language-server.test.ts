import {
  Document,
  DocumentSnapshot,
  SvelteDocument,
  ts,
} from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/svelte-internals.ts";
import { normalize_transform_result } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/transform-results.ts";
import { patch_svelte_compiler_path } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/patches.ts";
import { prepare_virtual_document } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/virtual-document.ts";
import { rebind_snapshot_to_original_document } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/snapshot.ts";
import {
  transform_markup_effect,
  transform_script_effect,
  transform_svelte_effect,
} from "../../../modules/svelte-effect-runtime/src/runtime/transform.ts";
import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";

import * as compiler from "svelte/compiler";

const component_source = `<script lang="ts" effect>
  import { Effect } from "effect";

  const slug = "intro";

  function get_post(slug: string) {
    return Effect.succeed({ title: slug });
  }

  const post = yield* get_post(slug);
</script>

<h1>{post.title}</h1>
`;

type DocumentLike = {
  positionAt(offset: number): SourcePosition;
};

type SnapshotLike = {
  getFullText(): string;
  offsetAt(position: SourcePosition): number;
  getGeneratedPosition(position: SourcePosition): SourcePosition;
};

type SourcePosition = {
  line: number;
  character: number;
};

Deno.test("patched Svelte diagnostics compile script effect top-level await", async () => {
  patch_svelte_compiler_path(transform_svelte_effect);

  const document = make_document(component_source);
  const svelte_document = new SvelteDocument(document);
  const compiled = await svelte_document.getCompiled();

  assert(compiled.js);
});

Deno.test("virtual TS document removes the SER effect script attribute", () => {
  const document = make_document(component_source);
  const prepared = prepare_virtual_document(document, make_transforms());

  assert(prepared);

  const code = prepared.document.getText();

  assertFalse(/<script\b[^>]*\seffect(?:[\s=>]|$)/.test(code));
  assertStringIncludes(code, "const post = await");
});

Deno.test("virtual TS document recovers from script transform errors", () => {
  const source = [
    `<script lang="ts" effect>`,
    `  const query = "abc";`,
    `  const result = $derived.by(() => {`,
    `    if (!query) return [];`,
    `    yield* searchRemote({ query, limit: 10 });`,
    `  });`,
    `</script>`,
  ].join("\n");
  const document = make_document(source);
  const prepared = prepare_virtual_document(document, make_transforms());

  assert(prepared);
  assertStringIncludes(
    prepared.document.getText(),
    "__SER_language_server_transform_error",
  );
  assertStringIncludes(
    prepared.document.getText(),
    "yield* cannot be used inside $derived.by()",
  );
});

Deno.test("virtual TS snapshot maps SER hover positions to generated symbols", () => {
  const document = make_document(component_source);
  const prepared = prepare_virtual_document(document, make_transforms());

  assert(prepared);

  const snapshot = DocumentSnapshot.fromDocument(
    prepared.document,
    make_snapshot_options(),
  );
  const rebound_snapshot = rebind_snapshot_to_original_document(
    snapshot,
    document,
    prepared,
  );

  assert_maps_to_generated_text(
    rebound_snapshot,
    document,
    component_source.lastIndexOf("get_post"),
    "get_post",
  );
  assert_maps_to_generated_text(
    rebound_snapshot,
    document,
    component_source.indexOf("post ="),
    "post",
  );
  assert_maps_to_generated_text(
    rebound_snapshot,
    document,
    component_source.indexOf("post.title"),
    "post.title",
  );
});

Deno.test("virtual TS snapshot scopes bare const declaration tags", () => {
  const source = [
    `<script lang="ts">`,
    `  const entry = { foo: 1 };`,
    `  const params = { slug: "foo" };`,
    `</script>`,
    ``,
    `{#each Object.entries(entry) as [slug] ("/" + slug)}`,
    `  {const title = slug.replaceAll("-", " ")}`,
    `  {const href = "/docs/" + slug}`,
    `  {const is_active = slug === params.slug}`,
    ``,
    `  <a`,
    `    {href}`,
    `    aria-current={is_active ? "page" : undefined}`,
    `  >`,
    `    {title}`,
    `  </a>`,
    `{/each}`,
  ].join("\n");
  const document = make_document(source);
  const prepared = prepare_virtual_document(document, make_transforms());
  const snapshot = DocumentSnapshot.fromDocument(
    prepared?.document ?? document,
    make_snapshot_options(),
  );
  const rebound_snapshot = prepared
    ? rebind_snapshot_to_original_document(
      snapshot,
      document,
      prepared,
    )
    : snapshot;
  const scoped_diagnostics = collect_scoped_name_diagnostics(
    rebound_snapshot.getFullText(),
    ["href", "is_active", "title"],
  );

  assertEquals(scoped_diagnostics, []);
});

function make_document(content: string) {
  const filename = `${Deno.cwd()}/language-server-fixture.svelte`;
  const uri = make_file_uri(filename);
  const document = Document.createForTest(uri, content);

  document._compiler = compiler;

  return document;
}

function collect_scoped_name_diagnostics(
  text: string,
  names: string[],
): string[] {
  const file_name = "Component.svelte.ts";
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);

  host.getSourceFile = (name, language_version) =>
    name === file_name
      ? ts.createSourceFile(
        name,
        text,
        language_version,
        true,
        ts.ScriptKind.TS,
      )
      : undefined;
  host.readFile = (name) => name === file_name ? text : undefined;
  host.fileExists = (name) => name === file_name;
  host.writeFile = () => {};

  const program = ts.createProgram([file_name], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const pattern = new RegExp(`(?:${names.join("|")})`);

  return diagnostics
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    )
    .filter((message) => pattern.test(message));
}

function make_file_uri(filename: string): string {
  const normalized = filename.replace(/\\/g, "/");
  const encoded = encodeURI(normalized).replace(/\+/g, "%2B");
  const drive_match = /^([A-Za-z]):(.*)$/.exec(encoded);

  if (drive_match) {
    return `file:///${drive_match[1].toLowerCase()}%3A${drive_match[2]}`;
  }

  return `file://${encoded}`;
}

function make_transforms() {
  return {
    transformEffectMarkup: (code: string, options: { filename: string }) =>
      normalize_transform_result(
        transform_markup_effect(code, options.filename, { target: "editor" }),
        code,
        options.filename,
      ),
    transformEffectScript: (code: string, options: { filename: string }) =>
      normalize_transform_result(
        transform_script_effect(code, options.filename),
        code,
        options.filename,
      ),
  };
}

function make_snapshot_options() {
  return {
    parse: compiler.parse,
    version: compiler.VERSION,
    typingsNamespace: "svelteHTML",
    transformOnTemplateError: true,
    emitJsDoc: true,
    rewriteExternalImports: false,
  };
}

function assert_maps_to_generated_text(
  snapshot: SnapshotLike,
  document: DocumentLike,
  original_offset: number,
  expected_text: string,
): void {
  const original_position = document.positionAt(original_offset);
  const generated_position = snapshot.getGeneratedPosition(original_position);
  const generated_offset = snapshot.offsetAt(generated_position);
  const generated_text = snapshot.getFullText().slice(
    generated_offset,
    generated_offset + expected_text.length,
  );

  assertFalse(generated_position.line < 0);
  assertStringIncludes(generated_text, expected_text);
}
