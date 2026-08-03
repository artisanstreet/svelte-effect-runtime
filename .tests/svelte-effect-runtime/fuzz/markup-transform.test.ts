import {
	all_markup_fragments,
	make_markup_component_arbitrary,
	get_markup_fragment,
	make_markup_fragment_arbitrary,
	render_markup_component,
	type MarkupComponentSpec,
	type MarkupFragmentSpec,
	type MarkupKind,
} from "./grammar/markup.ts";
import { transform_markup_effect } from "../../../modules/svelte-effect-runtime/src/markup/transform.ts";
import type { MarkupTransformTarget } from "../../../modules/svelte-effect-runtime/src/markup/transform.ts";
import { PreprocessError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { parse } from "svelte/compiler";
import { expect, test } from "vitest";

import * as fc from "fast-check";

const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 250);
const fuzz_timeout = Math.max(30_000, fuzz_runs * 60);

const targets = fc.constantFrom<MarkupTransformTarget>("client", "server");

function describe_case(source: string, target: string, extra = ""): string {
	return [
		"",
		`target=${target}`,
		"---------------- source ----------------",
		source,
		extra && "---------------- detail ----------------",
		extra,
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * The lowering replaces brace expressions by offset, so a mismatched range
 * produces markup that no longer contains the effect site it claimed to
 * rewrite. Any surviving `yield*` outside a generated helper means a candidate
 * was found and then lost.
 */
test(
	"supported markup positions lower and leave no yield behind",
	() => {
		fc.assert(
			fc.property(
				make_markup_component_arbitrary(["supported", "inert"]),
				targets,
				(spec, target) => {
					const source = render_markup_component(spec);

					let code: string;

					try {
						code = transform_markup_effect(source, "Fuzz.svelte", { target }).code;
					} catch (issue) {
						const reason = issue instanceof Error ? issue.message : String(issue);

						throw new Error(
							`transform threw on supported markup${describe_case(source, target, reason)}`,
						);
					}

					const problems = find_output_problems(spec, code);

					if (problems.length > 0) {
						throw new Error(
							`markup lowering produced invalid output${describe_case(
								source,
								target,
								`${problems.join("\n")}\n---------------- output ----------------\n${code}`,
							)}`,
						);
					}
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"unsupported markup positions fail with a tagged preprocess error",
	() => {
		fc.assert(
			fc.property(
				make_markup_component_arbitrary(["supported", "inert"]),
				make_markup_fragment_arbitrary(["rejected"]),
				fc.nat(),
				targets,
				(spec, rejected, position, target) => {
					const source = render_markup_component(
						splice_fragment(spec, rejected, position),
					);

					let thrown: unknown;

					try {
						transform_markup_effect(source, "Fuzz.svelte", { target });
					} catch (issue) {
						thrown = issue;
					}

					if (thrown === undefined) {
						throw new Error(
							`unsupported markup position was accepted${describe_case(source, target)}`,
						);
					}

					if (!(thrown instanceof PreprocessError)) {
						const reason = thrown instanceof Error ? thrown.stack : String(thrown);

						throw new Error(
							`expected a tagged PreprocessError${describe_case(source, target, String(reason))}`,
						);
					}
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"markup without effect work passes through byte for byte",
	() => {
		fc.assert(
			fc.property(make_markup_component_arbitrary(["inert"]), targets, (spec, target) => {
				const source = render_markup_component({ ...spec, script: inert_script });
				const result = transform_markup_effect(source, "Fuzz.svelte", { target });

				expect(result.has_yield, describe_case(source, target)).toBe(false);
				expect(result.code, describe_case(source, target)).toBe(source);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"transforming the same markup twice produces identical output",
	() => {
		fc.assert(
			fc.property(
				make_markup_component_arbitrary(["supported", "inert"]),
				targets,
				(spec, target) => {
					const source = render_markup_component(spec);

					const first = transform_markup_effect(source, "Fuzz.svelte", { target });
					const second = transform_markup_effect(source, "Fuzz.svelte", { target });

					expect(second.code, describe_case(source, target)).toBe(first.code);
					expect(second.has_yield).toBe(first.has_yield);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

const inert_script = `<script effect>\n\tconst id = 1;\n</script>`;

/**
 * Checks the lowered component.
 *
 * Generated code legitimately contains `yield*` inside the generator functions
 * it emits, so a bare search for the operator reports its own output. The real
 * invariants are that the component still parses and that no original effect
 * site survives verbatim — the transform wraps every operand in `ToEffect(...)`,
 * so the source text of a lowered site can never reappear intact.
 */
function find_output_problems(spec: MarkupComponentSpec, code: string): string[] {
	const problems: string[] = [];

	/**
	 * Script bodies are the script transform's responsibility and still hold raw
	 * SER syntax at this stage, so they are blanked before parsing. The tags stay
	 * in place, which keeps every markup offset and the surrounding structure
	 * exactly as the transform emitted them.
	 */
	try {
		parse(blank_script_contents(code), { modern: true });
	} catch (issue) {
		problems.push(`output does not parse: ${issue instanceof Error ? issue.message : issue}`);
	}

	const markup = strip_scripts(code);

	for (const entry of spec.fragments) {
		const fragment = get_markup_fragment(entry.fragment_id);

		if (fragment.kind !== "supported") {
			continue;
		}

		if (markup.includes(`yield* ${entry.effect}`)) {
			problems.push(`unlowered effect site: yield* ${entry.effect}`);
		}
	}

	return problems;
}

function strip_scripts(code: string): string {
	return code.replaceAll(/<script[\s\S]*?<\/script>/g, (match) => " ".repeat(match.length));
}

function blank_script_contents(code: string): string {
	return code.replaceAll(
		/(<script[^>]*>)([\s\S]*?)(<\/script>)/g,
		(_match, open: string, body: string, close: string) =>
			open + body.replaceAll(/[^\r\n]/g, " ") + close,
	);
}

function splice_fragment(
	spec: MarkupComponentSpec,
	fragment: MarkupFragmentSpec,
	position: number,
): MarkupComponentSpec {
	const fragments = [...spec.fragments];

	fragments.splice(position % (fragments.length + 1), 0, fragment);

	return { ...spec, fragments };
}

/**
 * Asserts the grammar's own labels against the transform. Without this a
 * position that silently stops being supported would reduce coverage instead
 * of failing.
 */
test("every markup fragment behaves as the grammar labels it", () => {
	const mislabelled = all_markup_fragments.flatMap((fragment) => {
		const source = render_markup_component({
			script: inert_script,
			fragments: [{ fragment_id: fragment.id, effect: "Load(id)" }],
			line_ending: "\n",
			trailing_style: false,
		});

		const observed = observe_fragment(source);

		return observed === fragment.kind
			? []
			: [`${fragment.id}: labelled ${fragment.kind}, saw ${observed}`];
	});

	expect(mislabelled).toEqual([]);
});

function observe_fragment(source: string): MarkupKind | "unexpected_error" {
	try {
		const result = transform_markup_effect(source, "Fuzz.svelte");

		return result.has_yield && result.code !== source ? "supported" : "inert";
	} catch (issue) {
		return issue instanceof PreprocessError ? "rejected" : "unexpected_error";
	}
}
