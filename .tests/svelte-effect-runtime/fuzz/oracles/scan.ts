import type {
	MarkupBraceExpression,
	ScriptRegion,
	SourceRange,
	SvelteEffectSourceScan,
} from "../../../../modules/svelte-effect-runtime/src/compiler/source-scan.ts";
import type { OutputViolation } from "./script.ts";

/**
 * A shifted scan is not simply a scan of the shifted source.
 *
 * Bare-const normalization inserts `@` at `open + 1`, and shifting maps `open`
 * and `inner_start` independently, so the shifted expression keeps the text the
 * user actually wrote and excludes the synthetic `@`. Brace adjacency therefore
 * holds only for a freshly computed scan.
 */
export type ScanMode = "fresh" | "shifted";

/**
 * Structural invariants every scan must satisfy, whether it came from the fast
 * scanner, the Svelte-parser path, or the opaque fallback.
 *
 * Every offset a scan reports is later used to slice the source, so an offset
 * that does not address the text it claims to address is a defect regardless of
 * which path produced it.
 */
export function find_scan_violations(
	scan: SvelteEffectSourceScan,
	mode: ScanMode = "fresh",
): OutputViolation[] {
	const violations: OutputViolation[] = [];
	const source = scan.source;

	const report = (rule: string, detail: string) => violations.push({ rule, detail });

	const check_range = (label: string, range: SourceRange) => {
		if (range.start < 0 || range.end < range.start || range.end > source.length) {
			report("in_bounds", `${label} is [${range.start}, ${range.end}] of ${source.length}`);
		}
	};

	/** Rule 1 — every reported range addresses real source. */
	scan.scripts.forEach((script, index) => check_range(`scripts[${index}]`, script));
	scan.styles.forEach((style, index) => check_range(`styles[${index}]`, style));
	scan.comments.forEach((comment, index) => check_range(`comments[${index}]`, comment));
	scan.excluded_ranges.forEach((range, index) => check_range(`excluded_ranges[${index}]`, range));

	/** Rule 2 — script offsets are ordered and their cached text matches. */
	scan.scripts.forEach((script, index) =>
		check_script(script, `scripts[${index}]`, source, report),
	);

	/** Rule 3 — brace expressions address a real `{ ... }` span. */
	scan.markup_expressions.forEach((expression, index) =>
		check_expression(expression, `markup_expressions[${index}]`, source, mode, report),
	);

	/** Rule 4 — merged exclusions are sorted and disjoint. */
	scan.excluded_ranges.forEach((range, index) => {
		const previous = scan.excluded_ranges[index - 1];

		if (previous && range.start <= previous.end) {
			report(
				"excluded_ranges_disjoint",
				`[${previous.start}, ${previous.end}] then [${range.start}, ${range.end}]`,
			);
		}
	});

	/** Rule 5 — brace expressions are ordered and never overlap. */
	scan.markup_expressions.forEach((expression, index) => {
		const previous = scan.markup_expressions[index - 1];

		if (previous && expression.open <= previous.close) {
			report(
				"markup_expressions_disjoint",
				`[${previous.open}, ${previous.close}] then [${expression.open}, ${expression.close}]`,
			);
		}
	});

	/** Rule 6 — a bare const tag points just inside its own brace. */
	scan.bare_const_tags.forEach((tag, index) => {
		if (tag.insert_position !== tag.open + 1) {
			report(
				"bare_const_insert_position",
				`bare_const_tags[${index}] inserts at ${tag.insert_position} for brace ${tag.open}`,
			);
		}

		if (!/^\s*const\s/.test(tag.expression.inner)) {
			report(
				"bare_const_is_declaration",
				`bare_const_tags[${index}] inner is ${JSON.stringify(tag.expression.inner)}`,
			);
		}
	});

	/** Rule 7 — scripts are reported in source order. */
	scan.scripts.forEach((script, index) => {
		const previous = scan.scripts[index - 1];

		if (previous && script.start < previous.end) {
			report("scripts_ordered", `scripts[${index}] starts before scripts[${index - 1}] ends`);
		}
	});

	/** Rule 8 — the named scripts agree with the entries in the list. */
	check_named_script(scan, scan.instance_script, "instance_script", report);
	check_named_script(scan, scan.effect_script, "effect_script", report);

	return violations;
}

function check_script(
	script: ScriptRegion,
	label: string,
	source: string,
	report: (rule: string, detail: string) => void,
): void {
	const ordered =
		script.start <= script.tag_name_end &&
		script.tag_name_end <= script.opening_tag_end &&
		script.opening_tag_end <= script.content_start &&
		script.content_start <= script.content_end &&
		script.content_end <= script.closing_tag_start &&
		script.closing_tag_start <= script.closing_tag_end &&
		script.closing_tag_end <= script.end;

	if (!ordered) {
		report(
			"script_offsets_ordered",
			`${label}: ${script.start}/${script.tag_name_end}/${script.opening_tag_end}/${script.content_start}/${script.content_end}/${script.closing_tag_start}/${script.closing_tag_end}/${script.end}`,
		);
	}

	const expected_text = source.slice(script.content_start, script.content_end);

	if (script.text !== expected_text) {
		report(
			"script_text_matches",
			`${label}: cached ${JSON.stringify(script.text)} but source has ${JSON.stringify(expected_text)}`,
		);
	}

	const expected_attributes = source.slice(script.tag_name_end, script.opening_tag_end - 1);

	if (script.attributes_text !== expected_attributes) {
		report(
			"script_attributes_text_matches",
			`${label}: cached ${JSON.stringify(script.attributes_text)} but source has ${JSON.stringify(expected_attributes)}`,
		);
	}

	script.attributes.forEach((attribute, index) => {
		const name = source.slice(attribute.name_start, attribute.name_end);

		if (name !== attribute.name) {
			report(
				"attribute_name_matches",
				`${label}.attributes[${index}]: reported ${JSON.stringify(attribute.name)} but source has ${JSON.stringify(name)}`,
			);
		}
	});
}

function check_expression(
	expression: MarkupBraceExpression,
	label: string,
	source: string,
	mode: ScanMode,
	report: (rule: string, detail: string) => void,
): void {
	if (source[expression.open] !== "{" || source[expression.close] !== "}") {
		report(
			"expression_braces",
			`${label}: source[${expression.open}]=${JSON.stringify(source[expression.open])} source[${expression.close}]=${JSON.stringify(source[expression.close])}`,
		);
	}

	const adjacent =
		mode === "fresh"
			? expression.inner_start === expression.open + 1
			: expression.inner_start > expression.open;

	if (!adjacent || expression.inner_end !== expression.close) {
		report(
			"expression_inner_span",
			`${label}: brace [${expression.open}, ${expression.close}] but inner [${expression.inner_start}, ${expression.inner_end}]`,
		);
	}

	const expected_inner = source.slice(expression.inner_start, expression.inner_end);

	if (expression.inner !== expected_inner) {
		report(
			"expression_inner_matches",
			`${label}: cached ${JSON.stringify(expression.inner)} but source has ${JSON.stringify(expected_inner)}`,
		);
	}

	if (expression.expression_text !== expression.inner.trim()) {
		report(
			"expression_text_is_trimmed",
			`${label}: ${JSON.stringify(expression.expression_text)}`,
		);
	}
}

function check_named_script(
	scan: SvelteEffectSourceScan,
	named: ScriptRegion | undefined,
	label: string,
	report: (rule: string, detail: string) => void,
): void {
	if (!named) {
		return;
	}

	const match = scan.scripts.find(
		(script) => script.start === named.start && script.end === named.end,
	);

	if (!match) {
		report(
			"named_script_present",
			`${label} at [${named.start}, ${named.end}] is not in scripts`,
		);

		return;
	}

	if (match.text !== named.text || match.content_start !== named.content_start) {
		report("named_script_agrees", `${label} disagrees with its entry in scripts`);
	}
}
