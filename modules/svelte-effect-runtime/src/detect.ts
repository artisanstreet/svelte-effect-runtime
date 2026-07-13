import ts from "typescript";

/**
 * Returns `true` when the node tree contains a `yield*` expression that is
 * not inside any function boundary (arrow function, function declaration,
 * function expression, method).
 *
 * @example
 * ```ts
 * const source_file = ts.createSourceFile(
 *   "test.ts",
 *   "yield* foo()",
 *   ts.ScriptTarget.Latest,
 * );
 * const contains_yield = contains_top_level_yield_star(source_file.statements[0]);
 * ```
 *
 * @since 2.0.0
 * @param node - The root node to search from.
 * @returns Whether a top-level yield* expression was found.
 */
export function contains_top_level_yield_star(node: ts.Node): boolean {
	if (is_function_boundary(node)) {
		return false;
	}

	if (is_yield_star_expression(node)) {
		return true;
	}

	return node.getChildren().some((child) => contains_top_level_yield_star(child));
}

/**
 * Returns `true` when the node is a function-like boundary that owns its
 * own yield/yield* semantics. A function boundary includes arrow functions,
 * function declarations, function expressions, methods, get accessors, and
 * set accessors.
 *
 * @example
 * ```ts
 * const source_file = ts.createSourceFile(
 *   "test.ts",
 *   "function foo() {}",
 *   ts.ScriptTarget.Latest,
 * );
 * const statement = source_file.statements[0];
 * const is_boundary = is_function_boundary(statement);
 * ```
 *
 * @since 2.0.0
 * @param node - The node to check.
 * @returns Whether the node is a function boundary.
 */
export function is_function_boundary(node: ts.Node): boolean {
	return (
		ts.isArrowFunction(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

function is_yield_star_expression(node: ts.Node): boolean {
	return (
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
		ts.isIdentifier(node.left) &&
		node.left.text === "yield"
	);
}
