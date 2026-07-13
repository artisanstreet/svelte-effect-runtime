import type { MarkupBraceExpression, ScriptRegion } from "$/compiler/source-scan.ts";
import { scan_svelte_effect_source } from "$/compiler/source-scan.ts";

import ts from "typescript";

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

interface ParsedMarkupExpression {
	source_file: ts.SourceFile;
	root_expression: ts.Expression | undefined;
}

const effect_member_names = [
	"all",
	"fail",
	"gen",
	"log",
	"promise",
	"runFork",
	"runPromise",
	"runSync",
	"succeed",
	"sync",
	"try",
	"tryPromise",
	"void",
] as const;
const effect_member_name_set = new Set<string>(effect_member_names);
const effect_runner_names = new Set(["runFork", "runPromise", "runSync"]);
const effect_gen_name = new Set(["gen"]);

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
	const effect_binding_paths = find_effect_binding_paths(scan.scripts);
	const line_starts = make_line_starts(code);

	return scan.markup_expressions.flatMap((expression) =>
		make_expression_diagnostics(filename, effect_binding_paths, expression, line_starts),
	);
}

function find_effect_binding_paths(scripts: readonly ScriptRegion[]): string[][] {
	const binding_paths = [["Effect"]];
	const seen_paths = new Set(["Effect"]);

	for (const script of scripts) {
		const source_file = ts.createSourceFile(
			"diagnostics-script.ts",
			script.text,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);

		for (const statement of source_file.statements) {
			for (const binding_path of get_effect_import_binding_paths(statement)) {
				const key = binding_path.join(".");

				if (seen_paths.has(key)) {
					continue;
				}

				seen_paths.add(key);
				binding_paths.push(binding_path);
			}
		}
	}

	return binding_paths;
}

function get_effect_import_binding_paths(statement: ts.Statement): string[][] {
	if (
		!ts.isImportDeclaration(statement) ||
		!ts.isStringLiteral(statement.moduleSpecifier) ||
		!statement.importClause ||
		statement.importClause.isTypeOnly
	) {
		return [];
	}

	const module_name = statement.moduleSpecifier.text;
	const named_bindings = statement.importClause.namedBindings;

	if (!named_bindings) {
		return [];
	}

	if (module_name === "effect" && ts.isNamedImports(named_bindings)) {
		return named_bindings.elements.flatMap((specifier) => {
			const imported_name = specifier.propertyName?.text ?? specifier.name.text;

			return !specifier.isTypeOnly && imported_name === "Effect"
				? [[specifier.name.text]]
				: [];
		});
	}

	if (module_name === "effect" && ts.isNamespaceImport(named_bindings)) {
		return [[named_bindings.name.text, "Effect"]];
	}

	if (module_name === "effect/Effect" && ts.isNamespaceImport(named_bindings)) {
		return [[named_bindings.name.text]];
	}

	return [];
}

function make_expression_diagnostics(
	filename: string,
	effect_binding_paths: readonly string[][],
	expression: MarkupBraceExpression,
	line_starts: number[],
): Diagnostic[] {
	const attribute_name = expression.attribute_name;
	const expression_text = expression.expression_text;
	const is_event_attribute = attribute_name !== undefined && attribute_name.startsWith("on");
	const is_attribute = attribute_name !== undefined;
	const parsed_expression = parse_markup_expression(expression_text, effect_binding_paths);

	if (!parsed_expression || !contains_effect_reference(parsed_expression, effect_binding_paths)) {
		return [];
	}

	if (starts_with_yield_star(parsed_expression)) {
		return [];
	}

	const loc = get_line_column(line_starts, expression.open);

	if (
		is_event_attribute &&
		is_callback_expression(parsed_expression) &&
		contains_yield_star(parsed_expression)
	) {
		return [
			make_diagnostic(
				loc,
				make_hidden_event_yield_warning(filename, attribute_name, expression_text),
			),
		];
	}

	if (contains_effect_runner(parsed_expression, effect_binding_paths)) {
		return [
			make_diagnostic(
				loc,
				make_explicit_runner_warning(filename, attribute_name, expression_text),
			),
		];
	}

	if (is_bare_effect_gen(parsed_expression, effect_binding_paths)) {
		return [
			make_diagnostic(
				loc,
				make_bare_effect_gen_warning(filename, attribute_name, expression_text),
			),
		];
	}

	if (is_event_attribute && is_callback_expression(parsed_expression)) {
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

function parse_markup_expression(
	expression_text: string,
	effect_binding_paths: readonly string[][],
): ParsedMarkupExpression | undefined {
	const has_binding_candidate = effect_binding_paths.some(([root_name]) =>
		expression_text.includes(root_name),
	);
	const has_member_candidate = effect_member_names.some((member_name) =>
		expression_text.includes(member_name),
	);

	if (!has_binding_candidate || !has_member_candidate) {
		return undefined;
	}

	const source_file = ts.createSourceFile(
		"diagnostics-expression.ts",
		`function* __SER___diagnostic() { return (${expression_text}); }`,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const wrapper = source_file.statements.find(ts.isFunctionDeclaration);
	const return_statement = wrapper?.body?.statements.find(ts.isReturnStatement);
	const root_expression = unwrap_parentheses(return_statement?.expression);

	return { source_file, root_expression };
}

function contains_effect_reference(
	parsed_expression: ParsedMarkupExpression,
	effect_binding_paths: readonly string[][],
): boolean {
	return some_node(parsed_expression.source_file, (node) =>
		is_effect_member(node, effect_binding_paths, effect_member_name_set),
	);
}

function contains_effect_runner(
	parsed_expression: ParsedMarkupExpression,
	effect_binding_paths: readonly string[][],
): boolean {
	return some_node(parsed_expression.source_file, (node) =>
		is_effect_member(node, effect_binding_paths, effect_runner_names),
	);
}

function is_bare_effect_gen(
	parsed_expression: ParsedMarkupExpression,
	effect_binding_paths: readonly string[][],
): boolean {
	const root_expression = parsed_expression.root_expression;

	return (
		root_expression !== undefined &&
		is_effect_member(root_expression, effect_binding_paths, effect_gen_name)
	);
}

function starts_with_yield_star(parsed_expression: ParsedMarkupExpression): boolean {
	const root_expression = parsed_expression.root_expression;

	return root_expression !== undefined && is_yield_star_expression(root_expression);
}

function contains_yield_star(parsed_expression: ParsedMarkupExpression): boolean {
	return some_node(parsed_expression.source_file, is_yield_star_expression);
}

function is_callback_expression(parsed_expression: ParsedMarkupExpression): boolean {
	const root_expression = parsed_expression.root_expression;

	return (
		root_expression !== undefined &&
		(ts.isArrowFunction(root_expression) || ts.isFunctionExpression(root_expression))
	);
}

function is_effect_member(
	node: ts.Node,
	effect_binding_paths: readonly string[][],
	member_names: ReadonlySet<string>,
): boolean {
	const access_path = get_static_access_path(node);

	if (!access_path || access_path.length < 2) {
		return false;
	}

	const member_name = access_path[access_path.length - 1];
	const owner_path = access_path.slice(0, -1);

	if (member_name === undefined) {
		return false;
	}

	return (
		member_names.has(member_name) &&
		effect_binding_paths.some((binding_path) => paths_equal(owner_path, binding_path))
	);
}

function get_static_access_path(node: ts.Node): string[] | undefined {
	if (ts.isIdentifier(node)) {
		return [node.text];
	}

	if (ts.isPropertyAccessExpression(node)) {
		const owner_path = get_static_access_path(node.expression);

		return owner_path ? [...owner_path, node.name.text] : undefined;
	}

	if (
		ts.isElementAccessExpression(node) &&
		node.argumentExpression &&
		(ts.isStringLiteral(node.argumentExpression) ||
			ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
	) {
		const owner_path = get_static_access_path(node.expression);

		return owner_path ? [...owner_path, node.argumentExpression.text] : undefined;
	}

	return undefined;
}

function paths_equal(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((part, index) => part === right[index]);
}

function some_node(node: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
	let matched = false;

	if (predicate(node)) {
		return true;
	}

	ts.forEachChild(node, (child) => {
		matched ||= some_node(child, predicate);
	});

	return matched;
}

function is_yield_star_expression(node: ts.Node): boolean {
	return (
		(ts.isYieldExpression(node) && node.asteriskToken !== undefined) ||
		(ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
			ts.isIdentifier(node.left) &&
			node.left.text === "yield")
	);
}

function unwrap_parentheses(expression: ts.Expression | undefined): ts.Expression | undefined {
	let current = expression;

	while (current && ts.isParenthesizedExpression(current)) {
		current = current.expression;
	}

	return current;
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
