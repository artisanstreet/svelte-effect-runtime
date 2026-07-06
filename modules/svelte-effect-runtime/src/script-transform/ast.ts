import ts from "typescript";

/**
 * Checks whether a node is a `yield*` binary expression.
 *
 * @since 2.0.0
 * @param node - TypeScript AST node to check.
 * @returns Whether the node represents `yield * operand`.
 */
export function is_yield_star_expression(node: ts.Node): boolean {
	return (
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
		ts.isIdentifier(node.left) &&
		node.left.text === "yield"
	);
}

/**
 * Checks whether a node owns its own yield semantics.
 *
 * @since 2.0.0
 * @param node - TypeScript AST node to check.
 * @returns Whether traversal should stop at this function boundary.
 */
export function is_function_boundary_node(node: ts.Node): boolean {
	return (
		ts.isArrowFunction(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

/**
 * Returns `true` if the node tree contains a top-level `await`.
 *
 * @since 2.0.0
 * @param node - Root node to search.
 * @returns Whether a top-level await expression was found.
 */
export function contains_top_level_await(node: ts.Node): boolean {
	if (ts.isAwaitExpression(node)) {
		return true;
	}

	return node
		.getChildren()
		.some((child) => !is_function_boundary_node(child) && contains_top_level_await(child));
}

/**
 * Collects top-level `yield*` nodes under an expression.
 *
 * @since 2.0.0
 * @param node - Root node to search.
 * @param on_found - Callback invoked for each matching yield node.
 * @returns Nothing.
 */
export function collect_yield_star_nodes(node: ts.Node, on_found: (node: ts.Node) => void): void {
	if (is_function_boundary_node(node)) {
		return;
	}

	if (is_yield_star_expression(node)) {
		on_found(node);
		return;
	}

	node.forEachChild((child) => {
		collect_yield_star_nodes(child, on_found);
	});
}

/**
 * Finds the first top-level `yield*` expression below a node.
 *
 * @since 2.0.0
 * @param node - Root node to search.
 * @param on_found - Callback invoked with the first matching node.
 * @returns Nothing.
 */
export function find_yield_star_node(node: ts.Node, on_found: (node: ts.Node) => void): void {
	if (is_function_boundary_node(node)) {
		return;
	}

	if (is_yield_star_expression(node)) {
		on_found(node);
		return;
	}

	node.forEachChild((child) => {
		find_yield_star_node(child, on_found);
	});
}

/**
 * Extracts identifier names from a TypeScript binding name.
 *
 * @since 2.0.0
 * @param name - Binding name node to flatten.
 * @returns Identifier names from identifiers and destructuring patterns.
 */
export function extract_binding_names(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) {
		return [name.text];
	}

	const result: string[] = [];

	for (const element of name.elements) {
		if (ts.isOmittedExpression(element)) {
			continue;
		}

		result.push(...extract_binding_names(element.name));
	}

	return result;
}
