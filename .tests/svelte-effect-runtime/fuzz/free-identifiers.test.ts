import { collect_free_identifiers } from "../../../modules/svelte-effect-runtime/src/markup/transform/expressions.ts";
import { expression_arbitrary, type ExpressionSpec } from "./grammar/expression.ts";
import { find_parse_errors } from "./oracles/script.ts";
import { expect, test } from "vitest";

import * as fc from "fast-check";

const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 250);
const fuzz_timeout = Math.max(30_000, fuzz_runs * 40);

function describe_case(spec: ExpressionSpec, observed: readonly string[]): string {
	return [
		"",
		"---------------- expression ----------------",
		spec.text,
		"---------------- expected ------------------",
		JSON.stringify([...spec.free].sort()),
		"---------------- observed ------------------",
		JSON.stringify([...observed].sort()),
	].join("\n");
}

/**
 * Guards the grammar itself. An expression that does not parse would make the
 * scope analyser look wrong when the generator is at fault, so invalid syntax
 * fails here rather than being reported as a defect in the code under test.
 */
test(
	"every generated expression is valid TypeScript",
	() => {
		fc.assert(
			fc.property(expression_arbitrary, (spec) => {
				const errors = find_parse_errors(`const __probe = (${spec.text});`);

				if (errors.length > 0) {
					throw new Error(
						`generator emitted invalid syntax: ${errors.join("; ")}\n${spec.text}`,
					);
				}
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * A missed identifier is the dangerous direction: the generated `$effect` never
 * reads that value, so Svelte never re-runs the effect and the component keeps
 * rendering a stale result with no error anywhere.
 */
test(
	"no free identifier is missed",
	() => {
		fc.assert(
			fc.property(expression_arbitrary, (spec) => {
				const observed = collect_free_identifiers(spec.text);
				const missing = [...spec.free].filter((name) => !observed.includes(name));

				if (missing.length > 0) {
					throw new Error(
						`missing dependencies ${JSON.stringify(missing)}${describe_case(spec, observed)}`,
					);
				}
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * A spurious identifier is the cheap direction — an extra dependency only costs
 * a redundant re-run — but it also means a bound name escaped its scope, which
 * is the same defect that produces a missed one.
 */
test(
	"no bound name is reported as free",
	() => {
		fc.assert(
			fc.property(expression_arbitrary, (spec) => {
				const observed = collect_free_identifiers(spec.text);
				const extra = observed.filter((name) => !spec.free.includes(name));

				if (extra.length > 0) {
					throw new Error(
						`spurious dependencies ${JSON.stringify(extra)}${describe_case(spec, observed)}`,
					);
				}
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"collected identifiers are unique and never internal",
	() => {
		fc.assert(
			fc.property(expression_arbitrary, (spec) => {
				const observed = collect_free_identifiers(spec.text);

				expect(new Set(observed).size, describe_case(spec, observed)).toBe(observed.length);
				expect(
					observed.filter((name) => name.startsWith("__SER___")),
					describe_case(spec, observed),
				).toEqual([]);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"collecting identifiers is deterministic",
	() => {
		fc.assert(
			fc.property(expression_arbitrary, (spec) => {
				expect(collect_free_identifiers(spec.text)).toEqual(
					collect_free_identifiers(spec.text),
				);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);
