import type { RuntimeImportBindings } from "./types.ts";

import ts from "typescript";

interface RuntimeImportOptions {
	needs_dispatcher?: boolean;
	needs_effect?: boolean;
	needs_untrack?: boolean;
	needs_on_destroy?: boolean;
	needs_yield_success?: boolean;
	needs_yieldable?: boolean;
	needs_scope_ref?: boolean;
}

export function make_imports(
	has_effect_import: boolean,
	has_dispatcher_import: boolean,
	has_untrack_import: boolean,
	has_on_destroy_import: boolean,
	bindings: RuntimeImportBindings = {
		cancel: "__SER___cancel",
		component_scope_ref: "ComponentScopeRef",
		dispatcher: "get_dispatcher",
		dispatcher_value: "__SER___dispatcher",
		effect: "Effect",
		on_destroy: "onDestroy",
		program: "__SER___program",
		scope: "__SER___scope",
		untrack: "untrack",
		yield_success: "YieldSuccess",
		yieldable: "ToEffect",
	},
	options: RuntimeImportOptions = {},
): string {
	const needs_dispatcher = options.needs_dispatcher ?? true;
	const needs_effect = options.needs_effect ?? true;
	const needs_untrack = options.needs_untrack ?? true;
	const needs_on_destroy = options.needs_on_destroy ?? false;
	const needs_yield_success = options.needs_yield_success ?? false;
	const needs_yieldable = options.needs_yieldable ?? false;
	const needs_scope_ref = options.needs_scope_ref ?? true;

	const generator_import = make_generator_import(
		bindings,
		needs_dispatcher && !has_dispatcher_import,
		needs_yieldable,
		needs_yield_success,
		needs_scope_ref,
	);

	const untrack_import =
		bindings.untrack === "untrack"
			? `import { untrack } from "svelte";`
			: `import { untrack as ${bindings.untrack} } from "svelte";`;

	const on_destroy_import =
		bindings.on_destroy === "onDestroy"
			? `import { onDestroy } from "svelte";`
			: `import { onDestroy as ${bindings.on_destroy} } from "svelte";`;

	const effect_import = has_effect_import
		? false
		: bindings.effect === "Effect"
			? `import { Effect } from "effect";`
			: `import { Effect as ${bindings.effect} } from "effect";`;

	return [
		generator_import,
		needs_untrack && !has_untrack_import && untrack_import,
		needs_on_destroy && !has_on_destroy_import && on_destroy_import,
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
	needs_scope_ref: boolean,
): string | false {
	const specifiers = [
		needs_dispatcher && make_named_import("get_dispatcher", bindings.dispatcher),
		needs_yieldable && make_named_import("ToEffect", bindings.yieldable),
		needs_yield_success && make_named_import("YieldSuccess", bindings.yield_success, true),
		needs_scope_ref && make_named_import("ComponentScopeRef", bindings.component_scope_ref),
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

export function has_local_import_binding(
	source_file: ts.SourceFile,
	module_name: string,
	local_name: string,
	allow_namespace_import = true,
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
			return allow_namespace_import && named_bindings.name.text === local_name;
		}

		return named_bindings.elements.some(
			(element) => !element.isTypeOnly && element.name.text === local_name,
		);
	});
}

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
