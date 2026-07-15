import ts from "typescript";

export function contains_top_level_yield_star(node: ts.Node): boolean {
	if (is_function_boundary(node)) {
		return false;
	}

	if (is_yield_star_expression(node)) {
		return true;
	}

	return node.getChildren().some((child) => contains_top_level_yield_star(child));
}

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
