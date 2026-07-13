import type { SvelteEffectSourceScan } from "./source-scan.ts";

import ts from "typescript";

const wrapper_name = "__SER___markup_identifiers";
const identifier_names_by_scan = new WeakMap<SvelteEffectSourceScan, ReadonlySet<string>>();

export function collect_markup_identifier_names(
	source_scan: SvelteEffectSourceScan,
): ReadonlySet<string> {
	const cached_names = identifier_names_by_scan.get(source_scan);

	if (cached_names) {
		return cached_names;
	}

	const names = new Set(source_scan.markup_binding_names);

	for (const expression of source_scan.markup_expressions) {
		const source_file = ts.createSourceFile(
			"markup-identifiers.ts",
			make_identifier_parse_source(expression.inner),
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);

		collect_source_file_identifier_names(source_file, names);
	}

	names.delete(wrapper_name);
	identifier_names_by_scan.set(source_scan, names);

	return names;
}

function make_identifier_parse_source(expression: string): string {
	const snippet = expression.match(/^(\s*)#snippet\s+([\s\S]*)$/);

	if (snippet) {
		return `function* ${wrapper_name}() { ${snippet[1]}function ${snippet[2]} {} }`;
	}

	return `function* ${wrapper_name}() { ${expression} }`;
}

function collect_source_file_identifier_names(
	source_file: ts.SourceFile,
	names: Set<string>,
): void {
	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && !is_non_runtime_property_name(node)) {
			names.add(node.text);
		}

		ts.forEachChild(node, visit);
	};

	visit(source_file);
}

function is_non_runtime_property_name(identifier: ts.Identifier): boolean {
	const parent = identifier.parent;

	return (
		is_within_type_node(identifier) ||
		(ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
		(ts.isPropertyAssignment(parent) && parent.name === identifier) ||
		(ts.isPropertySignature(parent) && parent.name === identifier) ||
		(ts.isMethodDeclaration(parent) && parent.name === identifier) ||
		(ts.isMethodSignature(parent) && parent.name === identifier) ||
		(ts.isGetAccessorDeclaration(parent) && parent.name === identifier) ||
		(ts.isSetAccessorDeclaration(parent) && parent.name === identifier) ||
		(ts.isPropertyDeclaration(parent) && parent.name === identifier) ||
		(ts.isEnumMember(parent) && parent.name === identifier) ||
		(ts.isBindingElement(parent) && parent.propertyName === identifier)
	);
}

function is_within_type_node(identifier: ts.Identifier): boolean {
	let ancestor: ts.Node | undefined = identifier.parent;

	while (ancestor) {
		if (ts.isTypeNode(ancestor)) {
			return true;
		}

		ancestor = ancestor.parent;
	}

	return false;
}
