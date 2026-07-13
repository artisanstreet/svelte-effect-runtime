import type { MarkupBraceExpression, ScriptRegion } from "$/compiler/source-scan.ts";
import { scan_svelte_effect_source } from "$/compiler/source-scan.ts";

/**
 * Warning diagnostic produced by the SER Vite diagnostics plugin.
 */
interface Diagnostic {
	message: string;
	line: number;
	column: number;
}

interface SourceLocation {
	line: number;
	column: number;
}

/**
 * Finds best-effort SER usage diagnostics in Svelte component markup.
 *
 * @example
 * ```ts
 * const diagnostics = find_svelte_effect_diagnostics(
 *   `<button onclick={Effect.gen}>save</button>`,
 *   "Button.svelte",
 * );
 * ```
 *
 * @since 2.0.0
 * @param code - Svelte component source to scan for suspicious Effect usage.
 * @param filename - Filename used in diagnostic messages.
 * @returns Warning diagnostics with a message and source location.
 */
export function find_svelte_effect_diagnostics(
	code: string,
	filename: string,
): Array<{ message: string; line: number; column: number }> {
	const scan = scan_svelte_effect_source(code, filename);
	const effect_names = find_effect_local_names(scan.scripts);
	const line_starts = make_line_starts(code);

	return scan.markup_expressions.flatMap((expression) =>
		make_expression_diagnostics(filename, effect_names, expression, line_starts),
	);
}

function find_effect_local_names(scripts: readonly ScriptRegion[]): Set<string> {
	const names = new Set<string>(["Effect"]);

	for (const script of scripts) {
		const import_pattern = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']effect["']/g;

		for (const import_match of script.text.matchAll(import_pattern)) {
			const is_type_only_import = import_match[1] !== undefined;
			const specifiers = import_match[2].split(",");

			if (is_type_only_import) {
				continue;
			}

			for (const specifier of specifiers) {
				const local_name = parse_effect_import_local_name(specifier);

				if (local_name) {
					names.add(local_name);
				}
			}
		}
	}

	return names;
}

function parse_effect_import_local_name(specifier: string): string | undefined {
	const trimmed = specifier.trim();
	const match = trimmed.match(/^Effect(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);

	if (!match) {
		return undefined;
	}

	return match[1] ?? "Effect";
}

function make_expression_diagnostics(
	filename: string,
	effect_names: Set<string>,
	expression: MarkupBraceExpression,
	line_starts: number[],
): Diagnostic[] {
	const attribute_name = expression.attribute_name;
	const expression_text = expression.expression_text;
	/** The source scanner exposes a name only for a direct single-expression value. */
	const is_event_attribute = attribute_name !== undefined && attribute_name.startsWith("on");
	const is_attribute = attribute_name !== undefined;

	if (!contains_effect_reference(expression_text, effect_names)) {
		return [];
	}

	if (starts_with_yield_star(expression_text)) {
		return [];
	}

	const loc = get_line_column(line_starts, expression.open);

	if (
		is_event_attribute &&
		is_callback_expression(expression_text) &&
		contains_yield_star(expression_text)
	) {
		return [
			make_diagnostic(
				loc,
				make_hidden_event_yield_warning(filename, attribute_name, expression_text),
			),
		];
	}

	if (contains_effect_runner(expression_text, effect_names)) {
		return [
			make_diagnostic(
				loc,
				make_explicit_runner_warning(filename, attribute_name, expression_text),
			),
		];
	}

	if (is_bare_effect_gen(expression_text, effect_names)) {
		return [
			make_diagnostic(
				loc,
				make_bare_effect_gen_warning(filename, attribute_name, expression_text),
			),
		];
	}

	if (is_event_attribute && is_callback_expression(expression_text)) {
		return [
			make_diagnostic(
				loc,
				make_event_callback_returns_effect_warning(
					filename,
					attribute_name,
					expression_text,
				),
			),
		];
	}

	if (is_event_attribute) {
		return [
			make_diagnostic(
				loc,
				make_event_attribute_effect_warning(filename, attribute_name, expression_text),
			),
		];
	}

	if (is_attribute) {
		return [
			make_diagnostic(
				loc,
				make_attribute_effect_warning(filename, attribute_name, expression_text),
			),
		];
	}

	return [make_diagnostic(loc, make_sync_markup_effect_warning(filename, expression_text))];
}

function make_diagnostic(loc: { line: number; column: number }, message: string): Diagnostic {
	return {
		message,
		line: loc.line,
		column: loc.column,
	};
}

function make_hidden_event_yield_warning(
	filename: string,
	attribute_name: string,
	expression_text: string,
): string {
	return [
		`[svelte-effect-runtime] Detected yield* hidden inside an event callback.`,
		`${filename}: ${attribute_name}={${expression_text}}`,
		`SER can only lower yield* at the event attribute boundary.`,
		`Write the event expression directly, for example: ${attribute_name}={yield* save()}`,
	].join("\n");
}

function make_explicit_runner_warning(
	filename: string,
	attribute_name: string | undefined,
	expression_text: string,
): string {
	const location = attribute_name
		? `${attribute_name}={${expression_text}}`
		: `{${expression_text}}`;

	return [
		`[svelte-effect-runtime] Detected an explicit Effect runner inside Svelte markup.`,
		`${filename}: ${location}`,
		`Explicit runners bypass SER cancellation and error handling for markup effects.`,
		`Prefer yield* so SER can manage the Effect lifecycle.`,
	].join("\n");
}

function make_bare_effect_gen_warning(
	filename: string,
	attribute_name: string | undefined,
	expression_text: string,
): string {
	const location = attribute_name
		? `${attribute_name}={${expression_text}}`
		: `{${expression_text}}`;
	const fixed = attribute_name
		? `${attribute_name}={yield* ${expression_text}(function* () { ... })}`
		: `{yield* ${expression_text}(function* () { ... })}`;

	return [
		`[svelte-effect-runtime] Detected Effect.gen used as a value instead of an Effect program.`,
		`${filename}: ${location}`,
		`${expression_text} is a constructor, not the result of running a generator.`,
		`Use: ${fixed}`,
	].join("\n");
}

function make_event_callback_returns_effect_warning(
	filename: string,
	attribute_name: string,
	expression_text: string,
): string {
	return [
		`[svelte-effect-runtime] Detected an event callback that returns an Effect but does not run it.`,
		`${filename}: ${attribute_name}={${expression_text}}`,
		`Svelte will call the callback and receive an Effect value, but SER will not manage it from inside the callback.`,
		`Use yield* at the event attribute boundary or explicitly run the Effect if you really want to bypass SER.`,
	].join("\n");
}

function make_event_attribute_effect_warning(
	filename: string,
	attribute_name: string,
	expression_text: string,
): string {
	const fixed = `${attribute_name}={yield* ${expression_text}}`;

	return [
		`[svelte-effect-runtime] Detected an event attribute that looks like an Effect but is not written with yield*.`,
		`${filename}: ${attribute_name}={${expression_text}}`,
		`If you are trying to use Effect in this event handler, use yield* at the beginning.`,
		`Use: ${fixed}`,
	].join("\n");
}

function make_attribute_effect_warning(
	filename: string,
	attribute_name: string,
	expression_text: string,
): string {
	const fixed = `${attribute_name}={yield* ${expression_text}}`;

	return [
		`[svelte-effect-runtime] Detected an attribute value that looks like an Effect but is not written with yield*.`,
		`${filename}: ${attribute_name}={${expression_text}}`,
		`Svelte attributes need the resolved Effect value, not the Effect object itself.`,
		`Use: ${fixed}`,
	].join("\n");
}

function make_sync_markup_effect_warning(filename: string, expression_text: string): string {
	return [
		`[svelte-effect-runtime] Detected a markup expression that creates an Effect but is not written with yield*.`,
		`${filename}: {${expression_text}}`,
		`This expression will produce an Effect value, not its result.`,
		`Use yield* where Svelte expects the resolved value.`,
	].join("\n");
}

function contains_effect_reference(expression_text: string, effect_names: Set<string>): boolean {
	const name_pattern = make_effect_name_pattern(effect_names);
	const effect_pattern = new RegExp(
		`\\b(?:${name_pattern})\\.(?:gen|succeed|fail|try|tryPromise|promise|sync|all|void|log|runPromise|runSync|runFork)\\b`,
	);

	return effect_pattern.test(expression_text);
}

function contains_effect_runner(expression_text: string, effect_names: Set<string>): boolean {
	const name_pattern = make_effect_name_pattern(effect_names);
	const runner_pattern = new RegExp(`\\b(?:${name_pattern})\\.run(?:Promise|Sync|Fork)\\b`);

	return runner_pattern.test(expression_text);
}

function is_bare_effect_gen(expression_text: string, effect_names: Set<string>): boolean {
	const name_pattern = make_effect_name_pattern(effect_names);
	const bare_gen_pattern = new RegExp(`^(?:${name_pattern})\\.gen$`);

	return bare_gen_pattern.test(expression_text);
}

function make_effect_name_pattern(effect_names: Set<string>): string {
	return [...effect_names]
		.map(escape_regexp)
		.sort((a, b) => b.length - a.length)
		.join("|");
}

function starts_with_yield_star(expression_text: string): boolean {
	return /^yield\s*\*/.test(expression_text);
}

function contains_yield_star(expression_text: string): boolean {
	return /\byield\s*\*/.test(expression_text);
}

function is_callback_expression(expression_text: string): boolean {
	return (
		/^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(expression_text) ||
		/^(?:async\s+)?function\b/.test(expression_text)
	);
}

function get_line_column(line_starts: number[], position: number): SourceLocation {
	let low = 0;
	let high = line_starts.length - 1;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);

		if (line_starts[mid] <= position) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	const line_index = Math.max(0, high);
	const line = line_index + 1;
	const column = position - line_starts[line_index];

	return { line, column };
}

function make_line_starts(code: string): number[] {
	const line_starts = [0];

	for (let i = 0; i < code.length; i += 1) {
		if (code[i] !== "\n") {
			continue;
		}

		line_starts.push(i + 1);
	}

	return line_starts;
}

function escape_regexp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
