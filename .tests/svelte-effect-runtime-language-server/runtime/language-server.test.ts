import {
	type SvelteInternalsService,
	SvelteInternals,
} from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/svelte-internals.ts";
import { rebind_snapshot_to_original_document } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/snapshot.ts";
import { normalize_transform_result } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/transform-results.ts";
import { prepare_virtual_document } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/virtual-document.ts";
import {
	assert_false,
	assert_equals,
	assert_string_includes,
	assert_truthy,
} from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import {
	get_server_dispatcher,
	reset_server_runtime,
	ServerRuntime,
} from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import {
	transform_markup_effect,
	transform_script_effect,
} from "../../../modules/svelte-effect-runtime/src/runtime/transform.ts";
import { LanguageServerLive } from "../../../modules/svelte-effect-runtime-language-server/src/patch-language-server/index.ts";
import { Bootstrap } from "../../../modules/svelte-effect-runtime-language-server/src/server.ts";
import { NodeServices } from "@effect/platform-node";
import { afterAll, beforeAll, test } from "vitest";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

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

let internals: SvelteInternalsService;

beforeAll(async () => {
	ServerRuntime.make(NodeServices.layer);

	internals = await get_server_dispatcher().run(
		Effect.gen(function* () {
			const loaded_internals = yield* SvelteInternals;

			yield* Bootstrap;

			return loaded_internals;
		}).pipe(Effect.provide(LanguageServerLive)),
	);
});

afterAll(() => {
	reset_server_runtime();
});

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

test("patched Svelte diagnostics compile script effect top-level await", async () => {
	const document = make_document(component_source);
	const svelte_document = new internals.svelte_document(document);
	const compiled = await svelte_document.getCompiled();

	assert_truthy(compiled.js);
});

test("virtual TS document removes the SER effect script attribute", () => {
	const document = make_document(component_source);
	const prepared = prepare_virtual_document(document, make_transforms(), internals);

	assert_truthy(prepared);

	const code = prepared.document.getText();

	assert_false(/<script\b[^>]*\seffect(?:[\s=>]|$)/.test(code));
	assert_string_includes(code, "const post = await");
});

test("virtual TS document recovers from script transform errors", () => {
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
	const prepared = prepare_virtual_document(document, make_transforms(), internals);

	assert_truthy(prepared);
	assert_string_includes(prepared.document.getText(), "__SER_language_server_transform_error");
	assert_string_includes(
		prepared.document.getText(),
		"yield* cannot be used inside $derived.by()",
	);
});

test("virtual TS document reports markup transform errors", () => {
	const document = make_document(`<h1>Hello</h1>`);
	const prepared = prepare_virtual_document(
		document,
		{
			...make_transforms(),
			transformEffectMarkup: () => {
				throw new Error("markup transform exploded");
			},
		},
		internals,
	);

	assert_truthy(prepared);
	assert_string_includes(prepared.document.getText(), "__SER_language_server_transform_error");
	assert_string_includes(prepared.document.getText(), "markup transform exploded");
});

test("virtual TS snapshot maps SER hover positions to generated symbols", () => {
	const document = make_document(component_source);
	const prepared = prepare_virtual_document(document, make_transforms(), internals);

	assert_truthy(prepared);

	const snapshot = internals.document_snapshot.fromDocument(
		prepared.document,
		make_snapshot_options(),
	);
	const rebound_snapshot = rebind_snapshot_to_original_document(snapshot, document, prepared);

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

test("virtual TS snapshot maps SER markup yield operands to generated operands", () => {
	const source = [
		`<script lang="ts">`,
		`  import { GetPosts, UpvotePost } from "./posts.remote";`,
		`</script>`,
		``,
		`{#each yield* GetPosts() as post}`,
		`  <button onclick={yield* UpvotePost(post.id)}>{post.name}</button>`,
		`{/each}`,
	].join("\n");
	const document = make_document(source);
	const prepared = prepare_virtual_document(document, make_transforms(), internals);

	assert_truthy(prepared);

	const snapshot = internals.document_snapshot.fromDocument(
		prepared.document,
		make_snapshot_options(),
	);
	const rebound_snapshot = rebind_snapshot_to_original_document(snapshot, document, prepared);

	assert_maps_to_generated_text(
		rebound_snapshot,
		document,
		source.indexOf("GetPosts()"),
		"GetPosts()",
	);
	assert_maps_to_generated_text(
		rebound_snapshot,
		document,
		source.indexOf("UpvotePost(post.id)"),
		"UpvotePost(post.id)",
	);
});

test("virtual TS document normalizes bare const tags without brace rescans", () => {
	const count = 6_000;
	const max_elapsed_ms = 2_500;
	const script_filler = Array.from(
		{ length: count },
		(_, index) => `{ const skipped_${index} = ${index}; }`,
	).join("\n");
	const style_filler = Array.from(
		{ length: count },
		(_, index) => `.item_${index} { color: red; }`,
	).join("\n");
	const comment_filler = Array.from(
		{ length: count },
		(_, index) => `{ const commented_${index} = ${index}; }`,
	).join("\n");
	const outside_filler = Array.from({ length: count }, (_, index) => `{ value_${index} }`).join(
		"\n",
	);
	const source = [
		`<script>`,
		script_filler,
		`</script>`,
		``,
		`<style>`,
		style_filler,
		`</style>`,
		``,
		`<!--`,
		comment_filler,
		`-->`,
		``,
		`{const title = "ok"}`,
		outside_filler,
	].join("\n");
	const document = make_document(source);
	const started_at = performance.now();
	const prepared = prepare_virtual_document(document, make_identity_transforms(), internals);
	const elapsed_ms = performance.now() - started_at;

	assert_truthy(prepared);
	assert_string_includes(prepared.document.getText(), `{@const title = "ok"}`);
	assert_false(prepared.document.getText().includes(`{@ const skipped_`));
	assert_false(prepared.document.getText().includes(`{@ const commented_`));
	if (elapsed_ms >= max_elapsed_ms) {
		throw new Error(`normalization took ${elapsed_ms.toFixed(1)}ms`);
	}
});

test("virtual TS snapshot scopes bare const declaration tags", () => {
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
	const prepared = prepare_virtual_document(document, make_transforms(), internals);
	const snapshot = internals.document_snapshot.fromDocument(
		prepared?.document ?? document,
		make_snapshot_options(),
	);
	const rebound_snapshot = prepared
		? rebind_snapshot_to_original_document(snapshot, document, prepared)
		: snapshot;
	const scoped_diagnostics = collect_scoped_name_diagnostics(rebound_snapshot.getFullText(), [
		"href",
		"is_active",
		"title",
	]);

	assert_equals(scoped_diagnostics, []);
});

test("virtual TS snapshot treats .sv files as Svelte documents", () => {
	const source = [
		`<script lang="ts">`,
		`  const route = "docs";`,
		`</script>`,
		``,
		`<Frame>`,
		`  {#snippet sidebar()}`,
		`    <Sidebar {route} />`,
		`  {/snippet}`,
		`</Frame>`,
	].join("\n");
	const filename = fileURLToPath(new URL("language-server-fixture.sv", import.meta.url));
	const snapshot = internals.document_snapshot.fromFilePath(
		filename,
		(path: string, text: string) => make_document(text, path),
		make_snapshot_options(),
		{
			readFile: (path: string) => (path === filename ? source : undefined),
		},
	);

	assert_equals(snapshot.parserError, null);
	assert_false(snapshot.getFullText().startsWith("<script"));
	assert_string_includes(snapshot.getFullText(), "sidebar");
});

function make_document(
	content: string,
	filename = fileURLToPath(new URL("language-server-fixture.svelte", import.meta.url)),
) {
	const uri = make_file_uri(filename);
	const document = internals.document.createForTest(uri, content);

	document._compiler = compiler;

	return document;
}

function collect_scoped_name_diagnostics(text: string, names: string[]): string[] {
	const ts = internals.typescript;
	const file_name = "Component.svelte.ts";
	const options: import("typescript").CompilerOptions = {
		module: ts.ModuleKind.ESNext,
		noLib: true,
		strict: true,
		target: ts.ScriptTarget.ESNext,
	};
	const host = ts.createCompilerHost(options);

	host.getSourceFile = (name, language_version) =>
		name === file_name
			? ts.createSourceFile(name, text, language_version, true, ts.ScriptKind.TS)
			: undefined;
	host.readFile = (name) => (name === file_name ? text : undefined);
	host.fileExists = (name) => name === file_name;
	host.writeFile = () => {};

	const program = ts.createProgram([file_name], options, host);
	const diagnostics = ts.getPreEmitDiagnostics(program);
	const pattern = new RegExp(`(?:${names.join("|")})`);

	return diagnostics
		.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
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

function make_identity_transforms() {
	return {
		transformEffectMarkup: (code: string) => ({ code, map: {} }),
		transformEffectScript: (code: string) => ({ code, map: {} }),
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
	const generated_text = snapshot
		.getFullText()
		.slice(generated_offset, generated_offset + expected_text.length);

	assert_false(generated_position.line < 0);
	assert_string_includes(generated_text, expected_text);
}
