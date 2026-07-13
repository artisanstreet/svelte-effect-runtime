import type { HelperDeclaration } from "./types.ts";

import ts from "typescript";

const effect_package_module = "effect";
const effect_direct_module = "effect/Effect";
const generated_effect_name = "__SER___Effect";

export interface EffectCallbackRewriteContext {
	/** Local names imported as the Effect object, such as `Effect` or `E`. */
	effect_object_names: ReadonlySet<string>;
	/** Namespace names imported from `effect/Effect`, such as `E.flatMap`. */
	effect_module_names: ReadonlySet<string>;
	/** Package namespace names imported from `effect`, such as `Fx.Effect`. */
	effect_package_names: ReadonlySet<string>;
	/** Direct `effect/Effect` imports mapped from local name to exported name. */
	direct_members: ReadonlyMap<string, string>;
	/** Expression used for generated `gen`, `sync`, and upgraded direct calls. */
	wrapper_expression: string;
	/** Import inserted when generated code needs a fresh Effect binding. */
	wrapper_import: HelperDeclaration | undefined;
}

interface EffectBindingState {
	effect_object_names: string[];
	effect_module_names: string[];
	effect_package_names: string[];
	direct_members: Map<string, string>;
	local_names: Set<string>;
	implicit_effect_import: boolean;
}

export function collect_effect_callback_bindings(content: string): EffectCallbackRewriteContext {
	const state = make_effect_binding_state();
	const scripts = collect_script_blocks(content);

	for (const script of scripts) {
		const source_file = ts.createSourceFile(
			"component-script.ts",
			script,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);

		collect_source_file_bindings(source_file, state);
	}

	ensure_implicit_effect_binding(state);

	const wrapper = choose_effect_wrapper(state);

	return {
		effect_object_names: new Set(state.effect_object_names),
		effect_module_names: new Set(state.effect_module_names),
		effect_package_names: new Set(state.effect_package_names),
		direct_members: new Map(state.direct_members),
		wrapper_expression: wrapper.expression,
		wrapper_import: wrapper.import_text ? { text: wrapper.import_text } : undefined,
	};
}

function make_effect_binding_state(): EffectBindingState {
	return {
		effect_object_names: [],
		effect_module_names: [],
		effect_package_names: [],
		direct_members: new Map(),
		local_names: new Set(),
		implicit_effect_import: false,
	};
}

function collect_script_blocks(content: string): string[] {
	const pattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

	return [...content.matchAll(pattern)].map((match) => match[1] ?? "");
}

function collect_source_file_bindings(source_file: ts.SourceFile, state: EffectBindingState): void {
	for (const statement of source_file.statements) {
		collect_statement_binding(statement, state);
	}
}

function collect_statement_binding(statement: ts.Statement, state: EffectBindingState): void {
	if (ts.isImportDeclaration(statement)) {
		collect_import_binding(statement, state);
		return;
	}

	if (ts.isImportEqualsDeclaration(statement)) {
		state.local_names.add(statement.name.text);
		return;
	}

	if (ts.isVariableStatement(statement)) {
		for (const declaration of statement.declarationList.declarations) {
			collect_binding_name(declaration.name, state.local_names);
		}

		return;
	}

	if (
		ts.isFunctionDeclaration(statement) ||
		ts.isClassDeclaration(statement) ||
		ts.isInterfaceDeclaration(statement) ||
		ts.isTypeAliasDeclaration(statement) ||
		ts.isEnumDeclaration(statement) ||
		ts.isModuleDeclaration(statement)
	) {
		if (statement.name) {
			state.local_names.add(statement.name.text);
		}
	}
}

function collect_import_binding(statement: ts.ImportDeclaration, state: EffectBindingState): void {
	if (!ts.isStringLiteral(statement.moduleSpecifier)) {
		return;
	}

	const module_name = statement.moduleSpecifier.text;
	const clause = statement.importClause;

	if (!clause) {
		return;
	}

	if (clause.name) {
		state.local_names.add(clause.name.text);
	}

	const named_bindings = clause.namedBindings;

	if (!named_bindings) {
		return;
	}

	if (ts.isNamespaceImport(named_bindings)) {
		collect_namespace_import_binding(module_name, named_bindings.name.text, state);
		return;
	}

	for (const element of named_bindings.elements) {
		collect_named_import_binding(module_name, element, state);
	}
}

function collect_namespace_import_binding(
	module_name: string,
	local_name: string,
	state: EffectBindingState,
): void {
	state.local_names.add(local_name);

	if (module_name === effect_direct_module) {
		add_ordered_name(state.effect_module_names, local_name);
		return;
	}

	if (module_name === effect_package_module) {
		add_ordered_name(state.effect_package_names, local_name);
	}
}

function collect_named_import_binding(
	module_name: string,
	element: ts.ImportSpecifier,
	state: EffectBindingState,
): void {
	const imported_name = element.propertyName?.text ?? element.name.text;
	const local_name = element.name.text;

	state.local_names.add(local_name);

	if (module_name === effect_package_module && imported_name === "Effect") {
		add_ordered_name(state.effect_object_names, local_name);
		return;
	}

	if (module_name === effect_direct_module) {
		state.direct_members.set(local_name, imported_name);
	}
}

function collect_binding_name(name: ts.BindingName, local_names: Set<string>): void {
	if (ts.isIdentifier(name)) {
		local_names.add(name.text);
		return;
	}

	for (const element of name.elements) {
		if (ts.isOmittedExpression(element)) {
			continue;
		}

		collect_binding_name(element.name, local_names);
	}
}

function ensure_implicit_effect_binding(state: EffectBindingState): void {
	if (has_effect_binding(state) || state.local_names.has("Effect")) {
		return;
	}

	add_ordered_name(state.effect_object_names, "Effect");
	state.implicit_effect_import = true;
}

function has_effect_binding(state: EffectBindingState): boolean {
	return (
		state.effect_object_names.length > 0 ||
		state.effect_module_names.length > 0 ||
		state.effect_package_names.length > 0 ||
		state.direct_members.size > 0
	);
}

function choose_effect_wrapper(state: EffectBindingState): {
	expression: string;
	import_text?: string;
} {
	const effect_object = state.effect_object_names[0];

	if (effect_object) {
		return state.implicit_effect_import
			? {
					expression: effect_object,
					import_text: `import { Effect } from "effect";`,
				}
			: { expression: effect_object };
	}

	const effect_module = state.effect_module_names[0];

	if (effect_module) {
		return { expression: effect_module };
	}

	const effect_package = state.effect_package_names[0];

	if (effect_package) {
		return { expression: `${effect_package}.Effect` };
	}

	const generated_name = make_generated_effect_name(state.local_names);

	return {
		expression: generated_name,
		import_text: `import { Effect as ${generated_name} } from "effect";`,
	};
}

function make_generated_effect_name(local_names: ReadonlySet<string>): string {
	if (!local_names.has(generated_effect_name)) {
		return generated_effect_name;
	}

	let index = 1;

	while (local_names.has(`${generated_effect_name}_${index}`)) {
		index += 1;
	}

	return `${generated_effect_name}_${index}`;
}

function add_ordered_name(names: string[], name: string): void {
	if (names.includes(name)) {
		return;
	}

	names.push(name);
}
