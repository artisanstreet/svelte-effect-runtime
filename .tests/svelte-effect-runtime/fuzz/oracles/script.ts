import type { ScriptProgramSpec } from "../grammar/script.ts";
import { get_statement_shape } from "../grammar/script.ts";

import ts from "typescript";

/**
 * Output invariants for `transform_script_effect`.
 *
 * Every check here is implemented independently of the transform's own helpers.
 * Reusing `contains_top_level_yield_star` or `collect_top_level_binding_names`
 * would make the oracle agree with the implementation by construction, which is
 * precisely the failure mode a fuzz oracle exists to avoid.
 */

export interface OutputViolation {
	readonly rule: string;
	readonly detail: string;
}

const transpile_options: ts.TranspileOptions = {
	fileName: "Generated.ts",
	reportDiagnostics: true,
	compilerOptions: {
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.ESNext,
	},
};

export function find_output_violations(
	spec: ScriptProgramSpec,
	source: string,
	code: string,
): OutputViolation[] {
	const violations: OutputViolation[] = [];

	/** Rule 1 — generated code must still be syntactically valid TypeScript. */
	const parse_errors = find_parse_errors(code);

	if (parse_errors.length > 0) {
		violations.push({ rule: "parses", detail: parse_errors.join("; ") });
	}

	const output_file = parse(code);

	/** Rule 2 — no `yield*` may survive outside a generated generator body. */
	const surviving = find_top_level_yield_star_texts(output_file, code);

	if (surviving.length > 0) {
		violations.push({
			rule: "no_top_level_yield",
			detail: `unlowered yield*: ${surviving.join(" | ")}`,
		});
	}

	/** Rule 3 — injected names must not collide with anything already declared. */
	const duplicates = find_duplicate_names(collect_declared_names(output_file));

	if (duplicates.length > 0) {
		violations.push({
			rule: "no_duplicate_bindings",
			detail: `declared twice: ${duplicates.join(", ")}`,
		});
	}

	/** Rule 4 — lowering a statement must not drop its `export` modifier. */
	const input_exports = collect_exported_names(parse(source));
	const output_exports = collect_exported_names(output_file);
	const dropped = [...input_exports].filter((name) => !output_exports.has(name));

	if (dropped.length > 0) {
		violations.push({
			rule: "preserves_exports",
			detail: `exports dropped: ${dropped.join(", ")}`,
		});
	}

	/** Rule 5 — statements the transform does not own must survive verbatim. */
	const mangled = find_mangled_inert_statements(spec, code);

	if (mangled.length > 0) {
		violations.push({
			rule: "preserves_inert_statements",
			detail: `missing from output: ${mangled.join(" | ")}`,
		});
	}

	return violations;
}

export function find_parse_errors(code: string): string[] {
	const output = ts.transpileModule(code, transpile_options);

	return (output.diagnostics ?? [])
		.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
		.map(
			(diagnostic) =>
				`TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
		);
}

function parse(code: string): ts.SourceFile {
	return ts.createSourceFile(
		"Generated.ts",
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
}

/**
 * SER writes `yield*` in ordinary module scope, where TypeScript parses it as a
 * multiplication of an identifier named `yield`. Detection therefore matches the
 * binary-expression shape rather than a yield expression node.
 */
function is_yield_star(node: ts.Node): boolean {
	return (
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
		ts.isIdentifier(node.left) &&
		node.left.text === "yield"
	);
}

function is_function_like(node: ts.Node): boolean {
	return (
		ts.isArrowFunction(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

function find_top_level_yield_star_texts(source_file: ts.SourceFile, code: string): string[] {
	const found: string[] = [];

	function visit(node: ts.Node): void {
		if (is_function_like(node)) {
			return;
		}

		if (is_yield_star(node)) {
			found.push(code.slice(node.getStart(), node.end).replaceAll("\n", " "));

			return;
		}

		node.forEachChild(visit);
	}

	source_file.statements.forEach(visit);

	return found;
}

function collect_declared_names(source_file: ts.SourceFile): string[] {
	return source_file.statements.flatMap((stmt) => {
		if (ts.isImportDeclaration(stmt)) {
			return collect_import_names(stmt);
		}

		if (ts.isVariableStatement(stmt)) {
			return stmt.declarationList.declarations.flatMap((decl) =>
				collect_binding_names(decl.name),
			);
		}

		if (
			ts.isFunctionDeclaration(stmt) ||
			ts.isClassDeclaration(stmt) ||
			ts.isEnumDeclaration(stmt)
		) {
			return stmt.name ? [stmt.name.text] : [];
		}

		return [];
	});
}

function collect_import_names(stmt: ts.ImportDeclaration): string[] {
	const clause = stmt.importClause;

	if (!clause) {
		return [];
	}

	const default_name = clause.name ? [clause.name.text] : [];
	const bindings = clause.namedBindings;

	if (!bindings) {
		return default_name;
	}

	if (ts.isNamespaceImport(bindings)) {
		return [...default_name, bindings.name.text];
	}

	return [...default_name, ...bindings.elements.map((element) => element.name.text)];
}

function collect_binding_names(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) {
		return [name.text];
	}

	return name.elements.flatMap((element) =>
		ts.isOmittedExpression(element) ? [] : collect_binding_names(element.name),
	);
}

function find_duplicate_names(names: readonly string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();

	for (const name of names) {
		if (seen.has(name)) {
			duplicates.add(name);
		}

		seen.add(name);
	}

	return [...duplicates];
}

function collect_exported_names(source_file: ts.SourceFile): Set<string> {
	const names = source_file.statements.flatMap((stmt) => {
		if (ts.isExportDeclaration(stmt)) {
			const clause = stmt.exportClause;

			return clause && ts.isNamedExports(clause)
				? clause.elements.map((element) => element.name.text)
				: [];
		}

		if (!has_export_modifier(stmt)) {
			return [];
		}

		if (ts.isVariableStatement(stmt)) {
			return stmt.declarationList.declarations.flatMap((decl) =>
				collect_binding_names(decl.name),
			);
		}

		if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
			return stmt.name ? [stmt.name.text] : [];
		}

		return [];
	});

	return new Set(names);
}

function has_export_modifier(stmt: ts.Statement): boolean {
	return (
		ts.canHaveModifiers(stmt) &&
		(ts.getModifiers(stmt) ?? []).some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		)
	);
}

function find_mangled_inert_statements(spec: ScriptProgramSpec, code: string): string[] {
	return spec.statements
		.map((statement, index) => ({
			shape: get_statement_shape(statement.shape_id),
			text: get_statement_shape(statement.shape_id).render(index, statement.effect),
		}))
		.filter((entry) => entry.shape.kind === "inert" && !code.includes(entry.text))
		.map((entry) => entry.text);
}
