import * as fc from "fast-check";

/**
 * Grammar of markup `yield*` positions.
 *
 * Positions are labelled from the documented component syntax: SER supports a
 * fixed set of effect sites, rejects a handful of shapes with named
 * diagnostics, and leaves everything else alone. The labels are asserted
 * against the transform rather than trusted, so a position that quietly stops
 * being supported fails the suite instead of shrinking its coverage.
 */

export type MarkupKind = "supported" | "rejected" | "inert";

export interface MarkupFragment {
	readonly id: string;
	readonly kind: MarkupKind;
	readonly render: (index: number, effect: string) => string;
}

const effect_expressions: readonly string[] = [
	"Load()",
	"Load(id)",
	"Service.load(id)",
	"Load(id).pipe(Effect.map((entry) => entry))",
	"Load({ id, limit: 10 })",
];

const markup_fragments: readonly MarkupFragment[] = [
	/** Supported effect sites. */
	{
		id: "expression_tag",
		kind: "supported",
		render: (_index, effect) => `<p>{yield* ${effect}}</p>`,
	},
	{
		id: "if_block",
		kind: "supported",
		render: (_index, effect) => `{#if yield* ${effect}}<span>yes</span>{/if}`,
	},
	{
		id: "if_else_block",
		kind: "supported",
		render: (_index, effect) =>
			`{#if yield* ${effect}}<span>yes</span>{:else}<span>no</span>{/if}`,
	},
	{
		id: "each_block",
		kind: "supported",
		render: (index, effect) =>
			`{#each yield* ${effect} as markup_entry_${index}}<li>{markup_entry_${index}}</li>{/each}`,
	},
	{
		id: "each_block_indexed",
		kind: "supported",
		render: (index, effect) =>
			`{#each yield* ${effect} as markup_entry_${index}, markup_position_${index}}<li>{markup_position_${index}}</li>{/each}`,
	},
	{
		id: "await_block",
		kind: "supported",
		render: (index, effect) =>
			`{#await yield* ${effect}}<p>loading</p>{:then markup_result_${index}}<p>{markup_result_${index}}</p>{/await}`,
	},
	{
		id: "key_block",
		kind: "supported",
		render: (_index, effect) => `{#key yield* ${effect}}<span>keyed</span>{/key}`,
	},
	{
		id: "declaration_tag",
		kind: "supported",
		render: (index, effect) =>
			`{#if true}{const markup_value_${index} = yield* ${effect}}<p>{markup_value_${index}}</p>{/if}`,
	},
	{
		id: "legacy_const_tag",
		kind: "supported",
		render: (index, effect) =>
			`{#if true}{@const markup_value_${index} = yield* ${effect}}<p>{markup_value_${index}}</p>{/if}`,
	},
	{
		id: "render_tag",
		kind: "supported",
		render: (_index, effect) => `{@render yield* ${effect}}`,
	},
	{
		id: "html_tag",
		kind: "supported",
		render: (_index, effect) => `{@html yield* ${effect}}`,
	},
	{
		id: "event_attribute",
		kind: "supported",
		render: (_index, effect) => `<button onclick={yield* ${effect}}>Save</button>`,
	},
	{
		id: "event_attribute_with_event",
		kind: "supported",
		render: (_index, effect) =>
			`<input oninput={yield* ${effect}.pipe(Effect.as(event.currentTarget.value))} />`,
	},
	{
		id: "legacy_event_directive",
		kind: "supported",
		render: (_index, effect) => `<button on:click={yield* ${effect}}>Save</button>`,
	},

	/** Rejected shapes, each with a named diagnostic. */
	{
		id: "component_prop",
		kind: "rejected",
		render: (_index, effect) => `<Widget value={yield* ${effect}} />`,
	},
	{
		id: "element_attribute",
		kind: "rejected",
		render: (_index, effect) => `<div title={yield* ${effect}}>text</div>`,
	},
	{
		id: "event_arrow_callback",
		kind: "rejected",
		render: (_index, effect) => `<button onclick={() => yield* ${effect}}>Save</button>`,
	},
	{
		id: "event_function_callback",
		kind: "rejected",
		render: (_index, effect) =>
			`<button onclick={function (event) { yield* ${effect}; }}>Save</button>`,
	},
	{
		id: "event_nested_callback",
		kind: "rejected",
		render: (_index, effect) =>
			`<button onclick={yield* Effect.try(() => yield* ${effect})}>Save</button>`,
	},

	/** Ordinary markup the transform must leave untouched. */
	{
		id: "plain_element",
		kind: "inert",
		render: (index) => `<p>plain ${index}</p>`,
	},
	{
		id: "plain_expression",
		kind: "inert",
		render: (index) => `<p>{markup_free_${index}}</p>`,
	},
	{
		id: "plain_event",
		kind: "inert",
		render: (index) => `<button onclick={() => record(${index})}>Go</button>`,
	},
	{
		id: "plain_each",
		kind: "inert",
		render: (index) =>
			`{#each items as markup_entry_${index}}<li>{markup_entry_${index}}</li>{/each}`,
	},
	{
		id: "plain_comment",
		kind: "inert",
		render: (index) => `<!-- comment ${index} -->`,
	},
	{
		id: "plain_snippet",
		kind: "inert",
		render: (index) => `{#snippet markup_row_${index}(entry)}<td>{entry}</td>{/snippet}`,
	},
];

const fragments_by_id = new Map(markup_fragments.map((fragment) => [fragment.id, fragment]));

export const all_markup_fragments: readonly MarkupFragment[] = markup_fragments;

export function get_markup_fragment(id: string): MarkupFragment {
	const fragment = fragments_by_id.get(id);

	if (!fragment) {
		throw new Error(`Unknown markup fragment: ${id}`);
	}

	return fragment;
}

export interface MarkupFragmentSpec {
	readonly fragment_id: string;
	readonly effect: string;
}

export interface MarkupComponentSpec {
	readonly script: string;
	readonly fragments: readonly MarkupFragmentSpec[];
	readonly line_ending: string;
	readonly trailing_style: boolean;
}

const scripts: readonly string[] = [
	`<script effect>\n\tconst id = 1;\n</script>`,
	`<script lang="ts" effect>\n\tconst id: number = 1;\n</script>`,
	`<script lang="ts" effect>\n\tconst id = 1;\n\tconst greeting = yield* Load(id);\n</script>`,
];

export function render_markup_component(spec: MarkupComponentSpec): string {
	const body = spec.fragments.map((entry, index) =>
		get_markup_fragment(entry.fragment_id).render(index, entry.effect),
	);

	const tail = spec.trailing_style ? [`<style>\n\tp { color: red; }\n</style>`] : [];
	const source = [spec.script, ...body, ...tail].join("\n");

	return spec.line_ending === "\n" ? source : source.replaceAll("\n", spec.line_ending);
}

export function make_markup_component_arbitrary(
	kinds: readonly MarkupKind[],
	max_fragments = 5,
): fc.Arbitrary<MarkupComponentSpec> {
	const allowed = markup_fragments.filter((fragment) => kinds.includes(fragment.kind));

	return fc
		.record({
			script: fc.constantFrom(...scripts),
			fragments: fc.array(make_markup_fragment_arbitrary(kinds), {
				minLength: 1,
				maxLength: max_fragments,
			}),
			line_ending: fc.constantFrom("\n", "\r\n"),
			trailing_style: fc.boolean(),
		})
		.filter(() => allowed.length > 0);
}

export function make_markup_fragment_arbitrary(
	kinds: readonly MarkupKind[],
): fc.Arbitrary<MarkupFragmentSpec> {
	const allowed = markup_fragments.filter((fragment) => kinds.includes(fragment.kind));

	return fc.record({
		fragment_id: fc.constantFrom(...allowed.map((fragment) => fragment.id)),
		effect: fc.constantFrom(...effect_expressions),
	});
}
