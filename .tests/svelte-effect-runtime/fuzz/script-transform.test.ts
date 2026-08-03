import {
	all_statement_shapes,
	make_script_program_arbitrary,
	make_statement_arbitrary,
	render_script_program,
	type ScriptProgramSpec,
	type StatementKind,
	type StatementSpec,
} from "./grammar/script.ts";
import type { MarkupTransformTarget } from "../../../modules/svelte-effect-runtime/src/markup/transform.ts";
import { transform_script_effect } from "../../../modules/svelte-effect-runtime/src/script-transform/index.ts";
import { PreprocessError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { find_output_violations, find_parse_errors } from "./oracles/script.ts";
import { expect, test } from "vitest";

import * as fc from "fast-check";

/**
 * Property-based fuzzing of the script transform.
 *
 * The seed is deliberately random: a pinned seed turns a fuzzer into a fixed
 * test suite that can never discover anything new. When a run fails, fast-check
 * prints the shrunk counterexample and its seed; commit that counterexample as a
 * regression test in `.tests/svelte-effect-runtime/compiler/` rather than
 * pinning the seed here.
 */
const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 250);

/** Each generated case parses two source files, so the budget scales with runs. */
const fuzz_timeout = Math.max(30_000, fuzz_runs * 40);

const transform_options = fc.record({
	target: fc.constantFrom<MarkupTransformTarget>("client", "server"),
	emit_types: fc.boolean(),
});

interface TransformOptions {
	readonly target: MarkupTransformTarget;
	readonly emit_types: boolean;
}

function describe_case(source: string, options: TransformOptions, extra = ""): string {
	return [
		"",
		`target=${options.target} emit_types=${options.emit_types}`,
		"---------------- input ----------------",
		source,
		extra && "---------------- detail ----------------",
		extra,
	]
		.filter(Boolean)
		.join("\n");
}

test(
	"valid programs lower without error and satisfy every output invariant",
	() => {
		fc.assert(
			fc.property(
				make_script_program_arbitrary(["effect", "inert"]),
				transform_options,
				(spec, options) => {
					const source = render_script_program(spec);

					/**
					 * Automatic semicolon insertion lets the grammar occasionally emit
					 * source that is invalid before the transform ever sees it. Those
					 * cases say nothing about the transform, so they are skipped rather
					 * than reported.
					 */
					fc.pre(find_parse_errors(source).length === 0);

					let code: string;

					try {
						code = transform_script_effect(source, "Fuzz.svelte", options).code;
					} catch (issue) {
						const reason = issue instanceof Error ? issue.message : String(issue);

						throw new Error(
							`transform threw on a valid program${describe_case(source, options, reason)}`,
						);
					}

					const violations = find_output_violations(spec, source, code);

					if (violations.length === 0) {
						return;
					}

					const detail = violations
						.map((violation) => `[${violation.rule}] ${violation.detail}`)
						.join("\n");

					throw new Error(
						`output invariants violated${describe_case(source, options, detail)}\n---------------- output ----------------\n${code}`,
					);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"programs without effect work pass through byte for byte",
	() => {
		fc.assert(
			fc.property(
				make_script_program_arbitrary(["inert"]),
				transform_options,
				(spec, options) => {
					const source = render_script_program(spec);
					const result = transform_script_effect(source, "Fuzz.svelte", options);

					expect(result.code, describe_case(source, options)).toBe(source);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"unsupported yield positions fail with a tagged preprocess error",
	() => {
		fc.assert(
			fc.property(
				make_script_program_arbitrary(["effect", "inert"]),
				make_statement_arbitrary(["rejected"]),
				fc.nat(),
				transform_options,
				(spec, rejected, position, options) => {
					const spliced = splice_statement(spec, rejected, position);
					const source = render_script_program(spliced);

					let thrown: unknown;

					try {
						transform_script_effect(source, "Fuzz.svelte", options);
					} catch (issue) {
						thrown = issue;
					}

					if (thrown === undefined) {
						throw new Error(
							`unsupported yield position was accepted${describe_case(source, options)}`,
						);
					}

					if (!(thrown instanceof PreprocessError)) {
						const reason = thrown instanceof Error ? thrown.stack : String(thrown);

						throw new Error(
							`expected a tagged PreprocessError${describe_case(source, options, String(reason))}`,
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
	"transforming the same source twice produces identical output",
	() => {
		fc.assert(
			fc.property(
				make_script_program_arbitrary(["effect", "inert"]),
				transform_options,
				(spec, options) => {
					const source = render_script_program(spec);

					const first = transform_script_effect(source, "Fuzz.svelte", options);
					const second = transform_script_effect(source, "Fuzz.svelte", options);

					expect(second.code, describe_case(source, options)).toBe(first.code);
				},
			),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

function splice_statement(
	spec: ScriptProgramSpec,
	statement: StatementSpec,
	position: number,
): ScriptProgramSpec {
	const index = position % (spec.statements.length + 1);
	const statements = [...spec.statements];

	statements.splice(index, 0, statement);

	return { ...spec, statements };
}

/**
 * Validates the grammar against the transform one shape at a time.
 *
 * A property failure is only trustworthy if the generator's own labels are
 * right. If a shape labelled `effect` turns out to be inert, the fuzz runs above
 * would quietly lose coverage instead of failing, so the labels are asserted
 * here rather than assumed.
 */
test("every statement shape behaves as the grammar labels it", () => {
	const mislabelled = all_statement_shapes.flatMap((shape) => {
		const spec: ScriptProgramSpec = {
			imports: [`import { Load } from "./data.remote.ts";`],
			shadows: [],
			trailing_import: false,
			statements: [{ shape_id: shape.id, effect: "Load(id)", trivia: "" }],
			indent: "",
			line_ending: "\n",
			trailing_newline: false,
		};

		const source = render_script_program(spec);
		const observed = observe_shape(source);

		return observed === shape.kind
			? []
			: [`${shape.id}: labelled ${shape.kind}, saw ${observed}`];
	});

	expect(mislabelled).toEqual([]);
});

function observe_shape(source: string): StatementKind | "unexpected_error" {
	try {
		const result = transform_script_effect(source, "Fuzz.svelte");

		return result.code === source ? "inert" : "effect";
	} catch (issue) {
		return issue instanceof PreprocessError ? "rejected" : "unexpected_error";
	}
}
