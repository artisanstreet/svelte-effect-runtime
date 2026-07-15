import ts from "typescript";

export function is_yield_star_expression(node: ts.Node): boolean {
	return (
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
		ts.isIdentifier(node.left) &&
		node.left.text === "yield"
	);
}

function is_function_boundary_node(node: ts.Node): boolean {
	return (
		ts.isArrowFunction(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

export function contains_top_level_await(node: ts.Node): boolean {
	if (ts.isAwaitExpression(node)) {
		return true;
	}

	return node
		.getChildren()
		.some((child) => !is_function_boundary_node(child) && contains_top_level_await(child));
}

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
