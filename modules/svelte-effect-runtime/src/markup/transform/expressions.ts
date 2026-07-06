import ts from "typescript";

/**
 * Strips an event handler arrow function down to its executable body.
 *
 * @since 2.0.0
 * @param expr - Event handler expression text from the original markup.
 * @returns Handler parameters, body text, and body offsets inside `expr`.
 */
export function strip_arrow_function(expr: string): {
	params: string;
	body: string;
	body_start: number;
	body_end: number;
} {
	const arrow_idx = expr.indexOf("=>");

	if (arrow_idx === -1) {
		return { params: "()", body: expr, body_start: 0, body_end: expr.length };
	}

	const params = expr.slice(0, arrow_idx).trim();
	const raw_body = expr.slice(arrow_idx + 2);
	const leading_ws = raw_body.length - raw_body.trimStart().length;
	let body_start = arrow_idx + 2 + leading_ws;
	let body_end = expr.length - (raw_body.length - raw_body.trimEnd().length);
	let body = expr.slice(body_start, body_end);

	if (body.startsWith("{") && body.endsWith("}")) {
		body_start += 1;
		body_end -= 1;
		body = body.slice(1, -1);
	}

	const body_leading_ws = body.length - body.trimStart().length;
	const body_trailing_ws = body.length - body.trimEnd().length;

	body_start += body_leading_ws;
	body_end -= body_trailing_ws;
	body = body.trim();

	if (body.endsWith(";")) {
		body = body.slice(0, -1);
		body_end -= 1;
	}

	return { params, body, body_start, body_end };
}

/**
 * Returns whether an expression is a callback function.
 *
 * @since 2.0.0
 * @param expr - Expression text from a markup attribute or expression tag.
 * @returns Whether the expression parses as an arrow or function expression.
 */
export function is_callback_function_expression(expr: string): boolean {
	const wrapped = `const __SER___callback = ${expr};`;
	const sf = ts.createSourceFile(
		"callback.ts",
		wrapped,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const stmt = sf.statements[0];

	if (!ts.isVariableStatement(stmt)) {
		return false;
	}

	const initializer = stmt.declarationList.declarations[0]?.initializer;

	return (
		initializer !== undefined &&
		(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
	);
}

/**
 * Classifies `yield*` placement inside an event handler body.
 *
 * @example
 * ```ts
 * analyze_event_body_yield_star("yield* save()");
 * ```
 *
 * @since 2.0.0
 * @param body - Event handler body text after the outer arrow has been
 *   stripped.
 * @returns Whether the body has top-level yield* expressions and whether any
 *   yield* appears inside a nested non-generator callback.
 */
export function analyze_event_body_yield_star(body: string): {
	has_top_level_yield_star: boolean;
	has_nested_invalid_yield_star: boolean;
} {
	const wrapped = `function* __SER___event() { ${body}; }`;
	const sf = ts.createSourceFile(
		"event.ts",
		wrapped,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const stmt = sf.statements[0];

	if (!ts.isFunctionDeclaration(stmt) || !stmt.body) {
		return {
			has_top_level_yield_star: false,
			has_nested_invalid_yield_star: /\byield\s*\*/.test(body),
		};
	}

	const result = {
		has_top_level_yield_star: false,
		has_nested_invalid_yield_star: false,
	};

	visit_event_body(stmt.body, "top_level", result);

	return result;
}

/**
 * Collects free identifiers that must be captured as reactive dependencies.
 *
 * @since 2.0.0
 * @param expr_text - Markup expression text to inspect.
 * @returns Identifier names referenced by the expression.
 */
export function collect_free_identifiers(expr_text: string): string[] {
	const wrapped = `function* __SER___w() { return (${expr_text}); }`;
	let sf: ts.SourceFile;

	try {
		sf = ts.createSourceFile(
			"expr.ts",
			wrapped,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
	} catch {
		return [];
	}

	const fn = sf.statements[0];

	if (!ts.isFunctionDeclaration(fn) || !fn.body) {
		return [];
	}

	const ids: string[] = [];
	const locals = new Set<string>();
	const seen = new Set<string>();

	visit_ids(fn.body, locals, seen, ids);

	return ids;
}

function visit_ids(node: ts.Node, locals: Set<string>, seen: Set<string>, ids: string[]): void {
	if (
		ts.isArrowFunction(node) ||
		ts.isFunctionExpression(node) ||
		ts.isFunctionDeclaration(node)
	) {
		const scoped = new Set(locals);

		if (ts.isFunctionDeclaration(node) && node.name) {
			scoped.add(node.name.text);
		}

		for (const parameter of node.parameters) {
			add_binding_names(parameter.name, scoped);
		}

		if (node.body) {
			visit_ids(node.body, scoped, seen, ids);
		}

		return;
	}

	if (ts.isVariableDeclaration(node)) {
		if (node.initializer) {
			visit_ids(node.initializer, locals, seen, ids);
		}

		add_binding_names(node.name, locals);

		return;
	}

	if (ts.isTypeReferenceNode(node)) {
		return;
	}

	if (ts.isIdentifier(node)) {
		if (
			node.text === "yield" ||
			node.text === "undefined" ||
			node.text === "null" ||
			node.text === "true" ||
			node.text === "false" ||
			node.text === "this"
		) {
			return;
		}

		if (is_property_access_name(node)) {
			return;
		}

		if (!locals.has(node.text) && !seen.has(node.text)) {
			seen.add(node.text);
			ids.push(node.text);
		}
		return;
	}

	node.forEachChild((child) => visit_ids(child, locals, seen, ids));
}

function add_binding_names(name: ts.BindingName, locals: Set<string>): void {
	if (ts.isIdentifier(name)) {
		locals.add(name.text);
		return;
	}

	for (const element of name.elements) {
		if (ts.isOmittedExpression(element)) {
			continue;
		}

		add_binding_names(element.name, locals);
	}
}

type EventYieldContext = "top_level" | "nested_generator" | "nested_invalid";

interface EventYieldAnalysis {
	has_top_level_yield_star: boolean;
	has_nested_invalid_yield_star: boolean;
}

function visit_event_body(
	node: ts.Node,
	context: EventYieldContext,
	result: EventYieldAnalysis,
): void {
	if (is_yield_star_expression(node)) {
		if (context === "top_level") {
			result.has_top_level_yield_star = true;
		} else if (context === "nested_invalid") {
			result.has_nested_invalid_yield_star = true;
		}

		node.forEachChild((child) => visit_event_body(child, context, result));
		return;
	}

	if (is_nested_function_boundary(node)) {
		const next_context = is_generator_function_boundary(node)
			? "nested_generator"
			: "nested_invalid";

		node.forEachChild((child) => visit_event_body(child, next_context, result));
		return;
	}

	node.forEachChild((child) => visit_event_body(child, context, result));
}

function is_nested_function_boundary(node: ts.Node): boolean {
	return (
		ts.isArrowFunction(node) ||
		ts.isFunctionExpression(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

function is_generator_function_boundary(node: ts.Node): boolean {
	return (
		(ts.isFunctionExpression(node) ||
			ts.isFunctionDeclaration(node) ||
			ts.isMethodDeclaration(node)) &&
		node.asteriskToken !== undefined
	);
}

function is_yield_star_expression(node: ts.Node): boolean {
	if (ts.isYieldExpression(node)) {
		return node.asteriskToken !== undefined;
	}

	return (
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
		ts.isIdentifier(node.left) &&
		node.left.text === "yield"
	);
}

function is_property_access_name(node: ts.Identifier): boolean {
	const parent = node.parent;

	return (
		(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
		(ts.isPropertyAssignment(parent) && parent.name === node) ||
		(ts.isBindingElement(parent) && parent.propertyName === node) ||
		ts.isImportSpecifier(parent) ||
		ts.isExportSpecifier(parent)
	);
}
