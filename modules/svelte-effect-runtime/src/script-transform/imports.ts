import type { RuntimeImportBindings } from "./types.ts";

import ts from "typescript";

interface RuntimeImportOptions {
	needs_dispatcher?: boolean;
	needs_effect?: boolean;
	needs_untrack?: boolean;
	needs_yield_success?: boolean;
	needs_yieldable?: boolean;
}

/**
 * Builds the import statements injected by the script transform.
 *
 * @example
 * ```ts
 * const imports = make_imports(false, false, false);
 * ```
 *
 * @since 2.0.0
 * @param has_effect_import - Whether the user already imports `Effect`.
 * @param has_dispatcher_import - Whether the user already imports
 *   `get_dispatcher`.
 * @param has_untrack_import - Whether the user already imports `untrack`.
 * @param bindings - Local names reserved for generated runtime helpers.
 * @param options - Runtime helper imports required by this transformed script.
 * @returns Newline-separated import statements to inject.
 */
export function make_imports(
	has_effect_import: boolean,
	has_dispatcher_import: boolean,
	has_untrack_import: boolean,
	bindings: RuntimeImportBindings = {
		cancel: "__SER___cancel",
		dispatcher: "get_dispatcher",
		dispatcher_value: "__SER___dispatcher",
		effect: "Effect",
		program: "__SER___program",
		untrack: "untrack",
		yield_success: "YieldSuccess",
		yieldable: "ToEffect",
	},
	options: RuntimeImportOptions = {},
): string {
	const needs_dispatcher = options.needs_dispatcher ?? true;
	const needs_effect = options.needs_effect ?? true;
	const needs_untrack = options.needs_untrack ?? true;
	const needs_yield_success = options.needs_yield_success ?? false;
	const needs_yieldable = options.needs_yieldable ?? false;

	const generator_import = make_generator_import(
		bindings,
		needs_dispatcher && !has_dispatcher_import,
		needs_yieldable,
		needs_yield_success,
	);

	const untrack_import =
		bindings.untrack === "untrack"
			? `import { untrack } from "svelte";`
			: `import { untrack as ${bindings.untrack} } from "svelte";`;

	const effect_import = has_effect_import
		? false
		: bindings.effect === "Effect"
			? `import { Effect } from "effect";`
			: `import { Effect as ${bindings.effect} } from "effect";`;

	return [
		generator_import,
		needs_untrack && !has_untrack_import && untrack_import,
		needs_effect && effect_import,
	]
		.filter(Boolean)
		.join("\n");
}

function make_generator_import(
	bindings: RuntimeImportBindings,
	needs_dispatcher: boolean,
	needs_yieldable: boolean,
	needs_yield_success: boolean,
): string | false {
	const specifiers = [
		needs_dispatcher && make_named_import("get_dispatcher", bindings.dispatcher),
		needs_yieldable && make_named_import("ToEffect", bindings.yieldable),
		needs_yield_success && make_named_import("YieldSuccess", bindings.yield_success, true),
	].filter((specifier): specifier is string => specifier !== false);

	if (specifiers.length === 0) {
		return false;
	}

	return `import { ${specifiers.join(", ")} } from "svelte-effect-runtime/internal/generators";`;
}

function make_named_import(imported_name: string, local_name: string, type_only = false): string {
	const prefix = type_only ? "type " : "";

	return imported_name === local_name
		? `${prefix}${imported_name}`
		: `${prefix}${imported_name} as ${local_name}`;
}

/**
 * Checks whether a source file imports a local binding from a module.
 *
 * @example
 * ```ts
 * const has_effect = has_local_import_binding(source_file, "effect", "Effect");
 * ```
 *
 * @since 2.0.0
 * @param source_file - Parsed TypeScript source file to inspect.
 * @param module_name - Module specifier to match.
 * @param local_name - Local binding name to look for.
 * @returns Whether that binding is already locally available.
 */
export function has_local_import_binding(
	source_file: ts.SourceFile,
	module_name: string,
	local_name: string,
): boolean {
	return source_file.statements.some((stmt) => {
		if (
			!ts.isImportDeclaration(stmt) ||
			!ts.isStringLiteral(stmt.moduleSpecifier) ||
			stmt.moduleSpecifier.text !== module_name
		) {
			return false;
		}

		const clause = stmt.importClause;

		if (!clause || clause.isTypeOnly) {
			return false;
		}

		if (clause.name?.text === local_name) {
			return true;
		}

		const named_bindings = clause.namedBindings;

		if (!named_bindings) {
			return false;
		}

		if (ts.isNamespaceImport(named_bindings)) {
			return named_bindings.name.text === local_name;
		}

		return named_bindings.elements.some(
			(element) => !element.isTypeOnly && element.name.text === local_name,
		);
	});
}

/**
 * Collects every local binding declared at module top level.
 *
 * @example
 * ```ts
 * const reserved_names = collect_top_level_binding_names(source_file);
 * ```
 *
 * @since 2.4.2
 * @param source_file - Parsed TypeScript source file to inspect.
 * @returns Top-level names declared by imports, declarations, and variables.
 */
export function collect_top_level_binding_names(source_file: ts.SourceFile): string[] {
	return source_file.statements.flatMap(collect_statement_binding_names);
}

function collect_statement_binding_names(stmt: ts.Statement): string[] {
	if (ts.isImportDeclaration(stmt)) {
		return collect_import_binding_names(stmt);
	}

	if (ts.isVariableStatement(stmt)) {
		return stmt.declarationList.declarations.flatMap((decl) =>
			collect_binding_name_text(decl.name),
		);
	}

	if (
		ts.isFunctionDeclaration(stmt) ||
		ts.isClassDeclaration(stmt) ||
		ts.isInterfaceDeclaration(stmt) ||
		ts.isTypeAliasDeclaration(stmt) ||
		ts.isEnumDeclaration(stmt) ||
		ts.isModuleDeclaration(stmt)
	) {
		return stmt.name ? [stmt.name.text] : [];
	}

	return [];
}

function collect_import_binding_names(stmt: ts.ImportDeclaration): string[] {
	const clause = stmt.importClause;

	if (!clause) {
		return [];
	}

	return [
		clause.name?.text,
		clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)
			? clause.namedBindings.name.text
			: undefined,
		clause.namedBindings && ts.isNamedImports(clause.namedBindings)
			? clause.namedBindings.elements.map((element) => element.name.text)
			: undefined,
	]
		.flat()
		.filter((name): name is string => name !== undefined);
}

function collect_binding_name_text(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) {
		return [name.text];
	}

	return name.elements.flatMap((element) => {
		if (ts.isOmittedExpression(element)) {
			return [];
		}

		return collect_binding_name_text(element.name);
	});
}
