import ts from "typescript";

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
	if (ts.isFunctionLike(node)) {
		const scoped = new Set(locals);

		if (
			(ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
			node.name !== undefined
		) {
			scoped.add(node.name.text);
		}

		/**
		 * A computed member name is evaluated in the enclosing scope, so it stays
		 * a dependency even though the member itself introduces a new scope.
		 */
		if ("name" in node && node.name !== undefined && ts.isComputedPropertyName(node.name)) {
			visit_ids(node.name.expression, locals, seen, ids);
		}

		for (const parameter of node.parameters) {
			add_binding_names(parameter.name, scoped);
		}

		/**
		 * Defaults are evaluated in parameter scope: they can reference the values
		 * this expression depends on, so skipping them drops a dependency and the
		 * effect silently stops re-running.
		 */
		for (const parameter of node.parameters) {
			if (parameter.initializer) {
				visit_ids(parameter.initializer, scoped, seen, ids);
			}
		}

		if ("body" in node && node.body) {
			visit_ids(node.body, scoped, seen, ids);
		}

		return;
	}

	/** A block-scoped declaration must not leak into the enclosing scope. */
	if (ts.isBlock(node) || ts.isCaseBlock(node)) {
		const scoped = new Set(locals);

		node.forEachChild((child) => visit_ids(child, scoped, seen, ids));

		return;
	}

	/**
	 * The iterable is evaluated before the loop binding exists, so it has to be
	 * walked in the enclosing scope. Binding first would silently swallow a
	 * dependency that happens to share the loop variable's name.
	 */
	if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
		const scoped = new Set(locals);

		visit_ids(node.expression, locals, seen, ids);
		visit_ids(node.initializer, scoped, seen, ids);
		visit_ids(node.statement, scoped, seen, ids);

		return;
	}

	if (ts.isForStatement(node)) {
		const scoped = new Set(locals);

		for (const part of [node.initializer, node.condition, node.incrementor]) {
			if (part) {
				visit_ids(part, scoped, seen, ids);
			}
		}

		visit_ids(node.statement, scoped, seen, ids);

		return;
	}

	if (ts.isCatchClause(node)) {
		const scoped = new Set(locals);

		if (node.variableDeclaration) {
			visit_ids(node.variableDeclaration, scoped, seen, ids);
		}

		visit_ids(node.block, scoped, seen, ids);

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
		/**
		 * Statement text reaches this collector through an expression-shaped
		 * wrapper, so parser error recovery can synthesise a nameless identifier.
		 * Emitting it produces a bare `;` in the generated dependency reads.
		 */
		if (node.text === "") {
			return;
		}

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

/**
 * Declaration names are not references. Emitting one as a dependency makes the
 * generated code read an identifier that was never declared, which fails at
 * runtime rather than merely re-running too often.
 */
function is_property_access_name(node: ts.Identifier): boolean {
	const parent = node.parent;

	return (
		(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
		(ts.isPropertyAssignment(parent) && parent.name === node) ||
		(ts.isPropertyDeclaration(parent) && parent.name === node) ||
		(ts.isClassDeclaration(parent) && parent.name === node) ||
		(ts.isClassExpression(parent) && parent.name === node) ||
		(ts.isBindingElement(parent) && parent.propertyName === node) ||
		ts.isImportSpecifier(parent) ||
		ts.isExportSpecifier(parent)
	);
}
