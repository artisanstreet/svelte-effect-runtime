import {
	scan_svelte_effect_source,
	shift_scan_after_at_insertions,
	type SourceRange,
	type SvelteEffectSourceScan,
} from "../../../modules/svelte-effect-runtime/src/compiler/source-scan.ts";
import {
	bare_const_component_arbitrary,
	component_arbitrary,
	render_component,
} from "./grammar/component.ts";
import { find_scan_violations, type ScanMode } from "./oracles/scan.ts";
import { expect, test } from "vitest";

import * as fc from "fast-check";

const fuzz_runs = Number(process.env.SER_FUZZ_RUNS ?? 250);

/** Scanning invokes the Svelte parser, so each case is heavier than a transform. */
const fuzz_timeout = Math.max(30_000, fuzz_runs * 60);

/** Distinct source used to evict the scanner's single-entry cache on demand. */
const cache_sentinel = `<p>cache sentinel</p>`;

function describe_source(source: string, extra = ""): string {
	return [
		"",
		"---------------- source ----------------",
		JSON.stringify(source),
		extra && "---------------- detail ----------------",
		extra,
	]
		.filter(Boolean)
		.join("\n");
}

function assert_no_violations(
	scan: SvelteEffectSourceScan,
	source: string,
	label: string,
	mode: ScanMode = "fresh",
): void {
	const violations = find_scan_violations(scan, mode);

	if (violations.length === 0) {
		return;
	}

	const detail = violations
		.map((violation) => `[${violation.rule}] ${violation.detail}`)
		.join("\n");

	throw new Error(`${label}${describe_source(source, detail)}`);
}

test(
	"every scan addresses the source it reports",
	() => {
		fc.assert(
			fc.property(component_arbitrary, (spec) => {
				const source = render_component(spec);

				scan_svelte_effect_source(cache_sentinel, "Sentinel.svelte");

				assert_no_violations(
					scan_svelte_effect_source(source, "Fuzz.svelte"),
					source,
					"scan invariants violated",
				);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * The scanner memoises its most recent result in module scope, keyed on source
 * and filename. A stale hit would hand a caller offsets for a different
 * document, so cold and warm results must be indistinguishable.
 */
test(
	"the scan cache never returns a result computed for different input",
	() => {
		fc.assert(
			fc.property(component_arbitrary, component_arbitrary, (first_spec, second_spec) => {
				const first_source = render_component(first_spec);
				const second_source = render_component(second_spec);

				scan_svelte_effect_source(cache_sentinel, "Sentinel.svelte");
				const cold = structuredClone(
					scan_svelte_effect_source(first_source, "First.svelte"),
				);

				const warm = structuredClone(
					scan_svelte_effect_source(first_source, "First.svelte"),
				);

				scan_svelte_effect_source(second_source, "Second.svelte");
				const recomputed = structuredClone(
					scan_svelte_effect_source(first_source, "First.svelte"),
				);

				expect(
					warm,
					describe_source(first_source, "warm hit differs from cold scan"),
				).toEqual(cold);
				expect(
					recomputed,
					describe_source(first_source, "scan after eviction differs from cold scan"),
				).toEqual(cold);
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

test(
	"the scan cache distinguishes identical sources under different filenames",
	() => {
		fc.assert(
			fc.property(component_arbitrary, (spec) => {
				const source = render_component(spec);

				const first = scan_svelte_effect_source(source, "First.svelte");
				const second = scan_svelte_effect_source(source, "Second.svelte");

				expect(first.filename).toBe("First.svelte");
				expect(second.filename).toBe("Second.svelte");
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * `shift_scan_after_at_insertions` reuses scan offsets after the language server
 * rewrites `{const ...}` into `{@const ...}`. Its binary search is checked here
 * against a deliberately naive linear reference.
 */
test(
	"shifting a scan past inserted characters matches a naive offset map",
	() => {
		fc.assert(
			fc.property(bare_const_component_arbitrary, (spec) => {
				const source = render_component(spec);

				scan_svelte_effect_source(cache_sentinel, "Sentinel.svelte");
				const scan = scan_svelte_effect_source(source, "Fuzz.svelte");
				const inserts = scan.bare_const_tags.map((tag) => tag.insert_position);

				fc.pre(inserts.length > 0);

				const normalized = insert_markers(source, inserts);
				const shifted = shift_scan_after_at_insertions(scan, normalized, inserts);
				const map = build_offset_map(source.length, inserts);

				const mismatches = [
					...compare_ranges("styles", scan.styles, shifted.styles, map),
					...compare_ranges("comments", scan.comments, shifted.comments, map),
					...compare_ranges(
						"excluded_ranges",
						scan.excluded_ranges,
						shifted.excluded_ranges,
						map,
					),
					...compare_ranges("scripts", scan.scripts, shifted.scripts, map),
					...compare_expressions(scan, shifted, map),
				];

				if (mismatches.length > 0) {
					throw new Error(
						`shifted offsets disagree with the reference map${describe_source(
							source,
							mismatches.join("\n"),
						)}`,
					);
				}

				/** The shifted scan must still describe the normalized source correctly. */
				assert_no_violations(
					shifted,
					normalized,
					"shifted scan invariants violated",
					"shifted",
				);

				/** Script bodies sit outside every insertion, so their text cannot change. */
				scan.scripts.forEach((script, index) => {
					expect(
						shifted.scripts[index]?.text,
						describe_source(source, `scripts[${index}] text changed while shifting`),
					).toBe(script.text);
				});
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

/**
 * Drives the shift arithmetic with arbitrary insertion points rather than only
 * the bare-const positions the language server happens to pass today. Duplicate
 * positions and insertions at offset zero or at end of file are the cases a
 * binary search is most likely to get wrong.
 */
test(
	"shifted offsets track arbitrary insertion points",
	() => {
		fc.assert(
			fc.property(component_arbitrary, fc.array(fc.nat(), { maxLength: 6 }), (spec, raw) => {
				const source = render_component(spec);

				scan_svelte_effect_source(cache_sentinel, "Sentinel.svelte");
				const scan = scan_svelte_effect_source(source, "Fuzz.svelte");

				fc.pre(source.length > 0);

				const inserts = raw
					.map((value) => value % (source.length + 1))
					.sort((left, right) => left - right);
				const normalized = insert_markers(source, inserts);
				const shifted = shift_scan_after_at_insertions(scan, normalized, inserts);
				const map = build_offset_map(source.length, inserts);

				const mismatches = [
					...compare_ranges("styles", scan.styles, shifted.styles, map),
					...compare_ranges("comments", scan.comments, shifted.comments, map),
					...compare_ranges(
						"excluded_ranges",
						scan.excluded_ranges,
						shifted.excluded_ranges,
						map,
					),
					...compare_ranges("scripts", scan.scripts, shifted.scripts, map),
					...compare_expressions(scan, shifted, map),
				];

				if (mismatches.length > 0) {
					throw new Error(
						`shifted offsets disagree with the reference map${describe_source(
							source,
							[`inserts: ${JSON.stringify(inserts)}`, ...mismatches].join("\n"),
						)}`,
					);
				}
			}),
			{ numRuns: fuzz_runs },
		);
	},
	fuzz_timeout,
);

function insert_markers(source: string, positions: readonly number[]): string {
	const sorted = [...positions].sort((left, right) => left - right);
	const parts: string[] = [];
	let cursor = 0;

	for (const position of sorted) {
		parts.push(source.slice(cursor, position), "@");
		cursor = position;
	}

	parts.push(source.slice(cursor));

	return parts.join("");
}

/**
 * Naive reference for the production binary search: for every original offset,
 * count how many insertions land at or before it.
 */
function build_offset_map(source_length: number, positions: readonly number[]): number[] {
	const map: number[] = [];

	for (let offset = 0; offset <= source_length; offset += 1) {
		map.push(offset + positions.filter((position) => position <= offset).length);
	}

	return map;
}

function compare_ranges(
	label: string,
	original: readonly SourceRange[],
	shifted: readonly SourceRange[],
	map: readonly number[],
): string[] {
	if (original.length !== shifted.length) {
		return [`${label}: ${original.length} ranges became ${shifted.length}`];
	}

	return original.flatMap((range, index) => {
		const moved = shifted[index];
		const problems: string[] = [];

		if (moved.start !== map[range.start]) {
			problems.push(`${label}[${index}].start: ${moved.start} expected ${map[range.start]}`);
		}

		if (moved.end !== map[range.end]) {
			problems.push(`${label}[${index}].end: ${moved.end} expected ${map[range.end]}`);
		}

		return problems;
	});
}

function compare_expressions(
	scan: SvelteEffectSourceScan,
	shifted: SvelteEffectSourceScan,
	map: readonly number[],
): string[] {
	if (scan.markup_expressions.length !== shifted.markup_expressions.length) {
		return [
			`markup_expressions: ${scan.markup_expressions.length} became ${shifted.markup_expressions.length}`,
		];
	}

	return scan.markup_expressions.flatMap((expression, index) => {
		const moved = shifted.markup_expressions[index];
		const problems: string[] = [];

		if (moved.open !== map[expression.open]) {
			problems.push(
				`markup_expressions[${index}].open: ${moved.open} expected ${map[expression.open]}`,
			);
		}

		if (moved.close !== map[expression.close]) {
			problems.push(
				`markup_expressions[${index}].close: ${moved.close} expected ${map[expression.close]}`,
			);
		}

		return problems;
	});
}
