import {
	make_script_program_arbitrary,
	render_script_program,
	type ScriptProgramSpec,
} from "./grammar/script.ts";
import {
	get_markup_fragment,
	make_markup_fragment_arbitrary,
	type MarkupFragmentSpec,
} from "./grammar/markup.ts";
import { transform_svelte_effect } from "../../../modules/svelte-effect-runtime/src/runtime/transform.ts";
import { PreprocessError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { compile } from "svelte/compiler";
import { expect, test } from "vitest";

import * as fc from "fast-check";

/**
 * End-to-end property over the whole component pipeline.
 *
 * Script lowering and markup lowering each edit the same file by offset, and
 * they run one after the other. Testing them separately cannot catch the case
 * where both are individually correct and their composition is not, so this
 * suite asserts the only thing that ultimately matters: Svelte can compile what
 * SER hands it, for both the browser and the server build.
 */

const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 100);
const fuzz_timeout = Math.max(60_000, fuzz_runs * 200);

/**
 * `export let` is a legacy props declaration that Svelte rejects outright in
 * runes mode, so a component containing one could never compile regardless of
 * what SER does with it.
 */
const excluded_script_shapes = new Set(["exported_let"]);

/**
 * Svelte refuses a component that mixes `on:click` with `onclick`, so the
 * legacy directive cannot share a generated component with the modern event
 * attributes. It stays covered on its own by the markup transform suite.
 */
const excluded_markup_fragments = new Set(["legacy_event_directive"]);

interface ComponentSpec {
	readonly script: ScriptProgramSpec;
	readonly fragments: readonly MarkupFragmentSpec[];
}

const component_arbitrary: fc.Arbitrary<ComponentSpec> = fc.record({
	script: make_script_program_arbitrary(["effect", "inert"], 5),
	fragments: fc.array(make_markup_fragment_arbitrary(["supported", "inert"]), {
		maxLength: 4,
	}),
});

function render(spec: ComponentSpec): string {
	const statements = spec.script.statements.filter(
		(statement) => !excluded_script_shapes.has(statement.shape_id),
	);
	const body = render_script_program({ ...spec.script, statements });
	const markup = spec.fragments
		.filter((entry) => !excluded_markup_fragments.has(entry.fragment_id))
		.map((entry, index) => get_markup_fragment(entry.fragment_id).render(index, entry.effect));

	return [`<script lang="ts" effect>`, body, `</script>`, ...markup].join("\n");
}

function describe_case(source: string, extra = ""): string {
	return [
		"",
		"---------------- source ----------------",
		source,
		extra && "---------------- detail ----------------",
		extra,
	]
		.filter(Boolean)
		.join("\n");
}

function compile_for(code: string, generate: "client" | "server"): void {
	compile(code, {
		filename: "Fuzz.svelte",
		generate,
		experimental: { async: true },
	});
}

test(
	"a lowered component compiles for the browser",
	() => {
		fc.assert(
			fc.property(component_arbitrary, (spec) => {
				const source = render(spec);
				const code = lower(source, "client");

				try {
					compile_for(code, "client");
				} catch (issue) {
					throw new Error(
						`svelte rejected the lowered component${describe_case(
							source,
							`${issue instanceof Error ? issue.message : String(issue)}\n---------------- output ----------------\n${code}`,
						)}`,
					);
				}
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"a lowered component compiles for the server",
	() => {
		fc.assert(
			fc.property(component_arbitrary, (spec) => {
				const source = render(spec);
				const code = lower(source, "server");

				try {
					compile_for(code, "server");
				} catch (issue) {
					throw new Error(
						`svelte rejected the lowered component${describe_case(
							source,
							`${issue instanceof Error ? issue.message : String(issue)}\n---------------- output ----------------\n${code}`,
						)}`,
					);
				}
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"lowering the same component twice produces identical output",
	() => {
		fc.assert(
			fc.property(component_arbitrary, (spec) => {
				const source = render(spec);

				expect(lower(source, "client"), describe_case(source)).toBe(
					lower(source, "client"),
				);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * The `effect` attribute is SER's opt-in marker and Svelte does not understand
 * it, so removing it is required rather than incidental. Everything else in a
 * component with no effect work must survive untouched.
 */
test(
	"a component without effect work changes only by losing its opt-in attribute",
	() => {
		fc.assert(
			fc.property(
				fc.record({
					script: make_script_program_arbitrary(["inert"], 5),
					fragments: fc.array(make_markup_fragment_arbitrary(["inert"]), {
						maxLength: 4,
					}),
				}),
				(spec) => {
					const source = render(spec);
					const expected = source.replace(
						`<script lang="ts" effect>`,
						`<script lang="ts">`,
					);

					expect(transform_svelte_effect(source, "Fuzz.svelte").code, source).toBe(
						expected,
					);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

function lower(source: string, target: "client" | "server"): string {
	try {
		return transform_svelte_effect(source, "Fuzz.svelte", { target }).code;
	} catch (issue) {
		if (issue instanceof PreprocessError) {
			throw new Error(
				`pipeline rejected a supported component${describe_case(source, issue.message)}`,
			);
		}

		throw new Error(
			`pipeline threw${describe_case(
				source,
				issue instanceof Error ? (issue.stack ?? issue.message) : String(issue),
			)}`,
		);
	}
}
