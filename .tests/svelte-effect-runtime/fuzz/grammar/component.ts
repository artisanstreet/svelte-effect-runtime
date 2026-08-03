import * as fc from "fast-check";

/**
 * Grammar-directed generator for whole `.svelte` component sources.
 *
 * The scanner has two paths: a hand-written fast scanner that bails out on
 * anything unusual, and a Svelte-parser path behind it. The fragment catalog is
 * chosen to straddle that boundary — entities, optional end tags, and nested
 * blocks all force the slow path, while plain markup stays on the fast one.
 */

export interface ComponentSpec {
	readonly module_script: string | undefined;
	readonly instance_script: string | undefined;
	readonly style: string | undefined;
	readonly fragments: readonly string[];
	readonly style_first: boolean;
	readonly line_ending: string;
}

const module_scripts: readonly string[] = [
	`<script module>\n\texport const shared = 1;\n</script>`,
	`<script context="module">\n\texport const shared = 1;\n</script>`,
	`<script module lang="ts">\n\texport const shared: number = 1;\n</script>`,
];

const instance_scripts: readonly string[] = [
	`<script>\n\tlet value = 1;\n</script>`,
	`<script lang="ts">\n\tlet value: number = 1;\n</script>`,
	`<script effect>\n\tconst user = yield* Load(id);\n</script>`,
	`<script lang="ts" effect>\n\tconst user = yield* Load(id);\n</script>`,
	`<script effect lang="ts">\n\tconst user = yield* Load(id);\n\tyield* Track(user);\n</script>`,
	`<script>\n\tconst pattern = /a}b/;\n\tconst text = "a { b }";\n</script>`,
];

const styles: readonly string[] = [
	`<style>\n\tp { color: red; }\n</style>`,
	`<style lang="scss">\n\tp { .nested { color: blue; } }\n</style>`,
	`<style>\n\tp { background: url("a}b.png"); }\n</style>`,
	`<style>\n\t/* } comment */\n\tp { color: red; }\n</style>`,
];

/**
 * Markup fragments. Several deliberately contain braces inside strings,
 * template literals, regexes, and comments, because brace matching is the
 * scanner's most delicate routine.
 */
const fragments: readonly string[] = [
	`<p>plain text</p>`,
	`{value}`,
	`{@const doubled = value * 2}`,
	`{const tripled = value * 3}`,
	`{const nested = { key: "value" }}`,
	`{@render row(value)}`,
	`{@html raw}`,
	`{@debug value}`,
	`{#if flag}<span>yes</span>{:else}<span>no</span>{/if}`,
	`{#each items as item, index}<li>{item}</li>{/each}`,
	`{#await promise}<p>loading</p>{:then result}<p>{result}</p>{:catch issue}<p>{issue}</p>{/await}`,
	`{#key value}<span>{value}</span>{/key}`,
	`{#snippet row(entry)}<td>{entry}</td>{/snippet}`,
	`<button onclick={yield* Save(id)}>Save</button>`,
	`<input bind:value={draft} />`,
	`<div style:color={tone}>tinted</div>`,
	`<div {...attributes}>spread</div>`,
	`<Child let:item>{item}</Child>`,
	`<!-- an html comment -->`,
	`<!-- comment with { brace } -->`,
	`<textarea>{value}</textarea>`,
	`<title>{value}</title>`,
	`<p>{ "a string with } brace" }</p>`,
	"<p>{`template ${value} literal`}</p>",
	`<p>{value /* inline } comment */}</p>`,
	`<p>{items.filter((entry) => entry > 0).length}</p>`,
	`<p>{value > 2 ? "big" : "small"}</p>`,
	`<p>{(/regex[}]/).test(value)}</p>`,
	/**
	 * Svelte reserves `{/` for block-closing tags, so a leading regex literal is
	 * unparseable and the scanner must fall back to an opaque scan. Kept so the
	 * fallback path stays covered.
	 */
	`<p>{/regex[}]/.test(value)}</p>`,
	`<br />`,
	`<img src="a.png" alt="a" />`,
	`<ul><li>one<li>two</ul>`,
	`<p>&amp; entity</p>`,
	`<div class="a b">{value}</div>`,
	`<div>{yield* Load(id)}</div>`,
	`{#if yield* Ready()}<span>ready</span>{/if}`,
];

export function render_component(spec: ComponentSpec): string {
	const head = [spec.module_script, spec.instance_script].filter(Boolean) as string[];
	const tail = spec.style ? [spec.style] : [];

	const body = spec.style_first
		? [...head, ...tail, ...spec.fragments]
		: [...head, ...spec.fragments, ...tail];

	const source = body.join("\n");

	return spec.line_ending === "\n" ? source : source.replaceAll("\n", spec.line_ending);
}

export const component_arbitrary: fc.Arbitrary<ComponentSpec> = fc.record({
	module_script: fc.option(fc.constantFrom(...module_scripts), { nil: undefined }),
	instance_script: fc.option(fc.constantFrom(...instance_scripts), { nil: undefined }),
	style: fc.option(fc.constantFrom(...styles), { nil: undefined }),
	fragments: fc.array(fc.constantFrom(...fragments), { maxLength: 8 }),
	style_first: fc.boolean(),
	line_ending: fc.constantFrom("\n", "\r\n"),
});

const bare_const_fragments: readonly string[] = fragments.filter((fragment) =>
	/^\{\s*const\s/.test(fragment),
);

/**
 * Components guaranteed to contain at least one bare `{const ...}` tag, so the
 * normalization path under test is always reached instead of being skipped by a
 * precondition.
 */
export const bare_const_component_arbitrary: fc.Arbitrary<ComponentSpec> = fc
	.tuple(component_arbitrary, fc.constantFrom(...bare_const_fragments), fc.nat({ max: 16 }))
	.map(([spec, bare_const, position]) => {
		const next = [...spec.fragments];

		next.splice(position % (next.length + 1), 0, bare_const);

		return { ...spec, fragments: next };
	});
