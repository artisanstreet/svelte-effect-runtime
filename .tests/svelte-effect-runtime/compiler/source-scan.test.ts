import {
	scan_svelte_effect_source,
	shift_scan_after_at_insertions,
} from "../../../modules/svelte-effect-runtime/src/compiler/source-scan.ts";
import { assert_equals, assert_exists } from "../unit/helpers/assert.ts";

import { test } from "vitest";

test("collects only real raw regions around structural lookalikes", () => {
	const nested_expression = [
		`{makeValue(`,
		`  "}",`,
		`  /** } */`,
		`  // }`,
		`  \`outer \${value ? \`inner \${other ? "<script>template_script</script>" : value}\` : "}"}\``,
		`)}`,
	].join("\n");
	const real_script = [
		`<script lang="ts" effect>`,
		`  const crossed_style = "<style>{fake_style}</style>";`,
		`  const fake_comment = "<!-- {fake_comment} -->";`,
		`  const nested_template = \`outer \${flag ? \`<style>fake</style>\` : \`\${value}\`}\`;`,
		`</script>`,
	].join("\n");
	const real_style = [
		`<style>`,
		`  .sentinel::before { content: "<script>{fake_script}</script>"; }`,
		`</style>`,
	].join("\n");
	const source = [
		`<!-- <script>comment_script</script><style>comment_style</style> -->`,
		`<div data-fake="<script>attribute_script</script><style>attribute_style</style>" onclick={yield* attribute_action()}></div>`,
		nested_expression,
		real_script,
		real_style,
		`<p>{yield* real()}</p>`,
	].join("\n");

	const scan = scan_svelte_effect_source(source, "Lookalikes.svelte");

	assert_equals(scan.scripts.length, 1);
	assert_equals(scan.styles.length, 1);
	assert_equals(scan.comments.length, 1);
	assert_equals(
		scan.markup_expressions.map(({ expression_text, attribute_name }) => ({
			expression_text,
			attribute_name,
		})),
		[
			{ expression_text: "yield* attribute_action()", attribute_name: "onclick" },
			{
				expression_text: nested_expression.slice(1, -1).trim(),
				attribute_name: undefined,
			},
			{ expression_text: "yield* real()", attribute_name: undefined },
		],
	);
	assert_equals(source.slice(scan.scripts[0]?.start, scan.scripts[0]?.end), real_script);
	assert_equals(source.slice(scan.styles[0]?.start, scan.styles[0]?.end), real_style);
	assert_equals(
		source.slice(scan.comments[0]?.start, scan.comments[0]?.end),
		`<!-- <script>comment_script</script><style>comment_style</style> -->`,
	);
});

test("tracks root ownership and classifies complete script attributes", () => {
	const module_script = [
		`<script context="module" lang="typescript">`,
		`  export const module_value = true;`,
		`</script>`,
	].join("\n");
	const instance_script = [
		`<script lang="ts" effect generics="T extends { module: string; marker: '>' }">`,
		`  const instance_value = true;`,
		`</script>`,
	].join("\n");
	const root_style = `<style>.root { color: green; }</style>`;
	const source = [
		`<SCRIPT>{upper_script}</SCRIPT>`,
		`<STYLE>{upper_style}</STYLE>`,
		`<img src="sentinel">`,
		`<Widget />`,
		`<div><script>nested_script</script><style>nested_style</style></div>`,
		`{#if visible}<script>blocked_script</script><style>blocked_style</style>{/if}`,
		module_script,
		instance_script,
		root_style,
	].join("\n");

	const scan = scan_svelte_effect_source(source, "Ownership.svelte");
	const module_region = scan.scripts[0];
	const instance_region = scan.scripts[1];

	assert_equals(scan.scripts.length, 2);
	assert_equals(scan.styles.length, 1);
	assert_equals(source.slice(module_region?.start, module_region?.end), module_script);
	assert_equals(source.slice(instance_region?.start, instance_region?.end), instance_script);
	assert_equals(source.slice(scan.styles[0]?.start, scan.styles[0]?.end), root_style);
	assert_equals(module_region?.is_module, true);
	assert_equals(module_region?.lang, "typescript");
	assert_equals(module_region?.is_typescript, true);
	assert_equals(instance_region?.is_module, false);
	assert_equals(instance_region?.has_effect, true);
	assert_equals(instance_region?.lang, "ts");
	assert_equals(instance_region?.is_typescript, true);
	assert_equals(
		instance_region?.attributes.map(({ name, value }) => ({ name, value })),
		[
			{ name: "lang", value: "ts" },
			{ name: "effect", value: undefined },
			{
				name: "generics",
				value: "T extends { module: string; marker: '>' }",
			},
		],
	);
	assert_equals(scan.instance_script?.start, instance_region?.start);
	assert_equals(scan.effect_script?.start, instance_region?.start);
	assert_equals(
		scan.markup_expressions.map((expression) => expression.expression_text),
		["upper_script", "upper_style", "#if visible", "/if"],
	);

	assert_exists(instance_region?.effect_attribute);
	assert_equals(
		source
			.slice(instance_region.effect_attribute.start, instance_region.effect_attribute.end)
			.trim(),
		"effect",
	);
});

test("keeps malformed tails opaque and mismatched closers conservative", () => {
	const malformed_sources = [
		`<!-- <script>comment_phantom</script>`,
		`{value + "<script>brace_phantom</script>"`,
		`<script>const crossed = "<style>raw_phantom</style>";`,
		`<div title="<script>attribute_phantom</script>\n<script>tag_phantom</script>`,
	];

	for (const [index, source] of malformed_sources.entries()) {
		const scan = scan_svelte_effect_source(source, `Malformed${index}.svelte`);
		const excluded_tail = scan.excluded_ranges.at(-1);

		assert_equals(scan.scripts.length, 0, `malformed case ${index}`);
		assert_equals(scan.styles.length, 0);
		assert_equals(scan.markup_expressions.length, 0);
		assert_equals(excluded_tail?.end, source.length);
	}

	const mismatched_source = [
		`<div>`,
		`  </span>`,
		`  <script>nested_after_mismatch</script>`,
		`</div>`,
		`<script>root_after_match</script>`,
	].join("\n");
	const mismatched_scan = scan_svelte_effect_source(mismatched_source, "Mismatched.svelte");

	assert_equals(mismatched_scan.scripts.length, 0);
	assert_equals(mismatched_scan.excluded_ranges, [{ start: 0, end: mismatched_source.length }]);
});

test("closes slash-bearing expressions with the TypeScript parser", () => {
	const source = String.raw`<p>{yield* match(/}/, /\{/, /[}]/)}</p><Widget {...make(/}/)} />`;
	const scan = scan_svelte_effect_source(source, "RegexBraces.svelte");

	assert_equals(
		scan.markup_expressions.map(({ expression_text, attribute_name }) => ({
			expression_text,
			attribute_name,
		})),
		[
			{
				expression_text: String.raw`yield* match(/}/, /\{/, /[}]/)`,
				attribute_name: undefined,
			},
			{ expression_text: "...make(/}/)", attribute_name: undefined },
		],
	);
});

test("revalidates an AST close skipped by geometric brace probes", () => {
	const source = `<Component>{fn(/}/, { a: 1 })}<p>{later}</p></Component>`;
	const scan = scan_svelte_effect_source(source, "SkippedBraceProbe.svelte");

	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["fn(/}/, { a: 1 })", "later"],
	);
});

test("bounds AST brace probing within one large division expression", () => {
	const object_count = 1_500;
	const max_elapsed_ms = 2_000;
	const objects = Array.from({ length: object_count }, (_, index) => `{ value: ${index} }`).join(
		",",
	);
	const expression = `left / right + [${objects}].length`;
	const source = `<Component>{${expression}}</Component>`;

	scan_svelte_effect_source(`<Component>{left / right}</Component>`, "BraceProbeWarmup.svelte");

	const started_at = performance.now();
	const scan = scan_svelte_effect_source(source, "LargeBraceProbe.svelte");
	const elapsed_ms = performance.now() - started_at;

	assert_equals(scan.markup_expressions.length, 1);
	assert_equals(scan.markup_expressions[0]?.expression_text, expression);

	if (elapsed_ms >= max_elapsed_ms) {
		throw new Error(`large AST brace probing took ${elapsed_ms.toFixed(1)}ms`);
	}
});

test("bounds TypeScript parsing for many slash-bearing expressions", () => {
	const count = 16_000;
	/**
	 * The superlinear scanning this guards against overshoots by orders of
	 * magnitude, so the budget only needs to exclude it — linear scanning
	 * was measured at ~5.1–5.5s on slow CI runners, which the previous 5s
	 * budget flaked on.
	 */
	const max_elapsed_ms = 10_000;
	const make_source = (count: number) =>
		`<Component>${Array.from(
			{ length: count },
			(_, index) => `<p>{match_${index}(/}/, ${index})}</p>`,
		).join("")}</Component>`;
	const measure = (count: number) => {
		const started_at = performance.now();
		const scan = scan_svelte_effect_source(make_source(count), `Regex${count}.svelte`);
		const elapsed_ms = performance.now() - started_at;

		assert_equals(scan.markup_expressions.length, count);

		return elapsed_ms;
	};

	measure(10);

	const elapsed_ms = measure(count);

	if (elapsed_ms >= max_elapsed_ms) {
		throw new Error(`bounded regex scanning took ${elapsed_ms.toFixed(1)}ms`);
	}
});

test("adapts slash-bearing Svelte directives before TypeScript parsing", () => {
	const cases = [
		{
			source: `{#if /}/.test(value)}<p>{value}</p>{/if}`,
			expressions: ["#if /}/.test(value)", "value", "/if"],
		},
		{
			source: `{#each values.filter((value) => /}/.test(value)) as value}<p>{value}</p>{/each}`,
			expressions: [
				"#each values.filter((value) => /}/.test(value)) as value",
				"value",
				"/each",
			],
		},
		{
			source: `{#await load(/}/) then value}<p>{value}</p>{/await}`,
			expressions: ["#await load(/}/) then value", "value", "/await"],
		},
		{
			source: `{@render render(/}/)}`,
			expressions: ["@render render(/}/)"],
		},
		{
			source: `{#if true}{@const matcher = /}/}<p>{matcher}</p>{/if}`,
			expressions: ["#if true", "@const matcher = /}/", "matcher", "/if"],
		},
	];

	for (const [index, { source, expressions }] of cases.entries()) {
		const scan = scan_svelte_effect_source(source, `Directive${index}.svelte`);

		assert_equals(
			scan.markup_expressions.map(({ expression_text }) => expression_text),
			expressions,
		);
	}
});

test("lets Svelte own implicit closes, void elements, and self-closing syntax", () => {
	const sources = [
		`<ul><li>one<li>two</ul><script>root</script>`,
		`<p>one<div>two</div><script>root</script>`,
		`<command><keygen><script>root</script>`,
		`<Widget/><div data-url=https://example.com/><script>root</script>`,
	];

	for (const [index, source] of sources.entries()) {
		const scan = scan_svelte_effect_source(source, `Ownership${index}.svelte`);

		assert_equals(scan.scripts.length, 1);
		assert_equals(scan.scripts[0]?.text, "root");
	}
});

test("keeps the bounded fast scan aligned with parser-owned expressions", () => {
	const markup = `<div><p>{first}</p><br/><span>{second}</span></div>`;
	const fast_scan = scan_svelte_effect_source(markup, "Fast.svelte");
	const parser_scan = scan_svelte_effect_source(
		`<Component>${markup}</Component>`,
		"Parser.svelte",
	);

	assert_equals(
		fast_scan.markup_expressions.map(({ expression_text }) => expression_text),
		parser_scan.markup_expressions.map(({ expression_text }) => expression_text),
	);
});

test("scans markup beside a root preprocessor style without parsing its body", () => {
	const style = `<style lang="scss">$color: red; .x { color: $color; }</style>`;
	const source = `${style}<p>{yield* load()}</p>`;
	const scan = scan_svelte_effect_source(source, "PreprocessorStyle.svelte");
	const spaced_style = `<style lang="scss">$color: red; .x { color: $color; }</style >`;
	const shadow_source = `<Component />${spaced_style}<p>{yield* load()}</p>`;
	const shadow_scan = scan_svelte_effect_source(
		shadow_source,
		"ShadowedPreprocessorStyle.svelte",
	);

	assert_equals(scan.styles.length, 1);
	assert_equals(source.slice(scan.styles[0]?.start, scan.styles[0]?.end), style);
	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* load()"],
	);
	assert_equals(shadow_scan.styles.length, 1);
	assert_equals(
		shadow_scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* load()"],
	);
	assert_equals(
		shadow_source.slice(shadow_scan.styles[0]?.start, shadow_scan.styles[0]?.end),
		spaced_style,
	);

	const commented_style = [
		`<style lang="scss">`,
		`// don't treat this apostrophe as a string delimiter`,
		`$color: red;`,
		`</style>`,
	].join("\n");
	const commented_source = `<Component />${commented_style}<p>{yield* load()}</p>`;
	const commented_scan = scan_svelte_effect_source(
		commented_source,
		"CommentedPreprocessorStyle.svelte",
	);

	assert_equals(commented_scan.styles.length, 1);
	assert_equals(
		commented_scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* load()"],
	);

	for (const [index, opening] of [`<style lang="css">`, `<style media="lang=scss">`].entries()) {
		const parser_style = `${opening}.x { content: "</style>"; }</style>`;
		const parser_source = `<Component />${parser_style}<p>{yield* load()}</p>`;
		const parser_scan = scan_svelte_effect_source(parser_source, `ParserStyle${index}.svelte`);

		assert_equals(parser_scan.styles.length, 1);
		assert_equals(
			parser_source.slice(parser_scan.styles[0]?.start, parser_scan.styles[0]?.end),
			parser_style,
		);
		assert_equals(
			parser_scan.markup_expressions.map(({ expression_text }) => expression_text),
			["yield* load()"],
		);
	}
});

test("keeps preprocessor closing-tag lookalikes inside line comments opaque", () => {
	const style = [
		`<style lang="scss">`,
		`// </style>`,
		`$color: red;`,
		`.button { color: $color; }`,
		`</style>`,
	].join("\n");
	const source = `${style}\n<p>{yield* load()}</p>`;
	const scan = scan_svelte_effect_source(source, "CommentedPreprocessorStyle.svelte");

	assert_equals(scan.styles.length, 1);
	assert_equals(source.slice(scan.styles[0]?.start, scan.styles[0]?.end), style);
	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* load()"],
	);
});

test("keeps URL slashes separate from preprocessor line comments", () => {
	const style = [
		`<style lang="scss">`,
		`// </style>`,
		`.hero { background: url(http://example.com/image.svg); }</style>`,
	].join("\n");
	const source = `${style}\n<p>{yield* load()}</p>`;
	const scan = scan_svelte_effect_source(source, "PreprocessorUrlStyle.svelte");

	assert_equals(scan.styles.length, 1);
	assert_equals(source.slice(scan.styles[0]?.start, scan.styles[0]?.end), style);
	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* load()"],
	);
});

test("recognizes preprocessor URL lexical variants before line comments", () => {
	const urls = [
		`url(//cdn.example.com/image.svg)`,
		`url ( http://example.com/image.svg )`,
		`url( "http://example.com/image.svg" )`,
		`url('http://example.com/image.svg')`,
		`url(http://example.com/a\\)b.svg)`,
	];

	for (const [index, url] of urls.entries()) {
		const style = [
			`<style lang="scss">`,
			`// </style>`,
			`.hero { background: ${url}; }</style>`,
		].join("\n");
		const source = `${style}\n<p>{yield* load()}</p>`;
		const scan = scan_svelte_effect_source(source, `PreprocessorUrl${index}.svelte`);

		assert_equals(scan.styles.length, 1);
		assert_equals(source.slice(scan.styles[0]?.start, scan.styles[0]?.end), style);
		assert_equals(
			scan.markup_expressions.map(({ expression_text }) => expression_text),
			["yield* load()"],
		);
	}
});

test("allows block-comment trivia after quoted preprocessor URLs", () => {
	const style = [
		`<style lang="scss">`,
		`// </style>`,
		`.hero { background: url("https://example.com/image.svg" /* cache key */); }</style>`,
	].join("\n");
	const source = `${style}\n<p>{yield* load()}</p>`;
	const scan = scan_svelte_effect_source(source, "CommentedPreprocessorUrl.svelte");

	assert_equals(scan.styles.length, 1);
	assert_equals(source.slice(scan.styles[0]?.start, scan.styles[0]?.end), style);
	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* load()"],
	);
});

test("shadows preprocessor styles after textarea lookalikes", () => {
	const source = [
		`<textarea><script>pseudo</script>{inside}</TEXTAREA>`,
		`<style lang="scss">$color: red; .x { color: $color; }</style >`,
		`<p>{yield* load()}</p>`,
	].join("\n");
	const scan = scan_svelte_effect_source(source, "RcdataPreprocessorStyle.svelte");

	assert_equals(scan.scripts.length, 0);
	assert_equals(scan.styles.length, 1);
	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["inside", "yield* load()"],
	);
});

test("keeps textarea text traversable without promoting its pseudo-tags", () => {
	const source = [
		`<textarea><script>pseudo {yield* inside()}</script></TEXTAREA>`,
		`<script>root</script>`,
	].join("\n");
	const scan = scan_svelte_effect_source(source, "Textarea.svelte");

	assert_equals(scan.scripts.length, 1);
	assert_equals(scan.scripts[0]?.text, "root");
	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* inside()"],
	);
});

test("excludes parser-owned comments between attributes", () => {
	const source = [
		`<div`,
		`  /* {yield* block_fake()} */`,
		`  onclick={yield* real()}`,
		`  // {yield* line_fake()}`,
		`  title="x"`,
		`></div>`,
	].join("\n");
	const scan = scan_svelte_effect_source(source, "AttributeComments.svelte");

	assert_equals(
		scan.markup_expressions.map(({ expression_text, attribute_name }) => ({
			expression_text,
			attribute_name,
		})),
		[{ expression_text: "yield* real()", attribute_name: "onclick" }],
	);
});

test("uses parser context and decoded script attributes", () => {
	const source = [
		`<script MODULE effect generics="T extends {">const instance = true;</script>`,
		`<script context="m&#111;dule">export const shared = true;</script>`,
	].join("\n");
	const scan = scan_svelte_effect_source(source, "ScriptContext.svelte");
	const instance = scan.scripts[0];
	const module = scan.scripts[1];

	assert_equals(instance?.is_module, false);
	assert_equals(instance?.has_effect, true);
	assert_equals(get_attribute_values(instance?.attributes), {
		MODULE: undefined,
		effect: undefined,
		generics: "T extends {",
	});
	assert_equals(module?.is_module, true);
	assert_equals(get_attribute_values(module?.attributes), { context: "module" });
});

test("keeps nested raw elements opaque and trusts root style boundaries", () => {
	const root_style = `<style>.root::before { content: "</style>"; }</style>`;
	const source = [
		`<div><script>{yield* nested_script()}</script>text<style>{nested_style}</style></div>`,
		root_style,
		`<script>root</script>`,
		`<p>{yield* shown()}</p>`,
	].join("\n");
	const scan = scan_svelte_effect_source(source, "RawOwnership.svelte");

	assert_equals(scan.scripts.length, 1);
	assert_equals(scan.scripts[0]?.text, "root");
	assert_equals(scan.styles.length, 1);
	assert_equals(source.slice(scan.styles[0]?.start, scan.styles[0]?.end), root_style);
	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* shown()"],
	);
});

test("keeps scripts nested in Unicode components out of root ownership", () => {
	const source = `<Ünicode><script>nested</script></Ünicode><script>root</script>`;
	const scan = scan_svelte_effect_source(source, "UnicodeComponent.svelte");

	assert_equals(scan.scripts.length, 1);
	assert_equals(scan.scripts[0]?.text, "root");
});

test("falls back opaquely when raw script closing text invalidates the component", () => {
	const source = `<script>const fake = "</script>";</script><p>{yield* phantom()}</p>`;
	const scan = scan_svelte_effect_source(source, "RawScriptClose.svelte");

	assert_equals(scan.scripts.length, 0);
	assert_equals(scan.markup_expressions.length, 0);
	assert_equals(scan.excluded_ranges, [{ start: 0, end: source.length }]);
});

test("normalizes every Effect yield before parsing script ownership", () => {
	const script = Array.from({ length: 257 }, (_, index) => `yield* task_${index}();`).join("\n");
	const source = `<script effect>${script}</script><p>{yield* shown()}</p>`;
	const scan = scan_svelte_effect_source(source, "ManyYields.svelte");

	assert_equals(scan.scripts.length, 1);
	assert_equals(scan.effect_script?.text, script);
	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* shown()"],
	);
});

test("normalizes render yields without breaking debug yields", () => {
	const source = `{@render yield* render_value()}{@debug yield* debug_value()}`;
	const scan = scan_svelte_effect_source(source, "SpecialTags.svelte");

	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["@render yield* render_value()", "@debug yield* debug_value()"],
	);
});

test("normalizes many render yields in one parser retry", () => {
	const count = 300;
	const source = Array.from(
		{ length: count },
		(_, index) => `{@render yield* render_${index}()}`,
	).join("\n");
	const scan = scan_svelte_effect_source(source, "ManyRenderTags.svelte");

	assert_equals(scan.markup_expressions.length, count);
	assert_equals(scan.markup_expressions[0]?.expression_text, "@render yield* render_0()");
	assert_equals(scan.markup_expressions.at(-1)?.expression_text, "@render yield* render_299()");
});

test("normalizes many parser-path yields before building the Svelte AST", () => {
	const count = 16_000;
	const max_elapsed_ms = 5_000;
	const make_source = (count: number) =>
		`<Widget />${Array.from(
			{ length: count },
			(_, index) => `<p>{yield* load_${index}()}</p>`,
		).join("")}`;
	const measure = (count: number) => {
		const started_at = performance.now();
		const scan = scan_svelte_effect_source(make_source(count), `Yields${count}.svelte`);
		const elapsed_ms = performance.now() - started_at;

		assert_equals(scan.markup_expressions.length, count);

		return elapsed_ms;
	};

	measure(10);

	const elapsed_ms = measure(count);

	if (elapsed_ms >= max_elapsed_ms) {
		throw new Error(`parser-path yield scanning took ${elapsed_ms.toFixed(1)}ms`);
	}
});

test("shifts many bare const tags without rescanning every insertion", () => {
	const count = 16_000;
	const max_elapsed_ms = 2_000;
	const source = Array.from(
		{ length: count },
		(_, index) => `{const value_${index} = ${index}}`,
	).join("\n");
	const scan = scan_svelte_effect_source(source, "ManyConstTags.svelte");
	const insert_positions = scan.bare_const_tags.map((tag) => tag.insert_position);
	const normalized_source = source.replaceAll("{const ", "{@const ");
	const started_at = performance.now();
	const shifted = shift_scan_after_at_insertions(scan, normalized_source, insert_positions);
	const elapsed_ms = performance.now() - started_at;

	assert_equals(shifted.markup_expressions.length, count);
	assert_equals(shifted.markup_expressions.at(-1)?.expression_text, `const value_15999 = 15999`);

	if (elapsed_ms >= max_elapsed_ms) {
		throw new Error(`shifting bare const tags took ${elapsed_ms.toFixed(1)}ms`);
	}
});

function get_attribute_values(
	attributes: readonly { name: string; value?: string | undefined }[] | undefined,
): Record<string, string | undefined> {
	return Object.fromEntries(attributes?.map(({ name, value }) => [name, value]) ?? []);
}
