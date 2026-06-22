import ts from "typescript";
import type { RuntimeImportBindings } from "./types.ts";

/**
 * Builds the import statements injected by the script preprocessor.
 *
 * @since 2.0.0
 * @param has_effect_import - Whether the user already imports `Effect`.
 * @param has_dispatcher_import - Whether the user already imports
 *   `get_dispatcher`.
 * @param has_untrack_import - Whether the user already imports `untrack`.
 * @returns Newline-separated import statements to inject.
 */
export function make_imports(
  has_effect_import: boolean,
  has_dispatcher_import: boolean,
  has_untrack_import: boolean,
  bindings: RuntimeImportBindings = { effect: "Effect" },
): string {
  const effect_import = has_effect_import
    ? false
    : bindings.effect === "Effect"
    ? `import { Effect } from "effect";`
    : `import { Effect as ${bindings.effect} } from "effect";`;

  return [
    !has_dispatcher_import &&
    `import { get_dispatcher } from "svelte-effect-runtime/internal/generators";`,
    !has_untrack_import && `import { untrack } from "svelte";`,
    effect_import,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Checks whether a source file imports a local binding from a module.
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
 * Checks whether a source file already has any top-level binding with a local
 * name.
 *
 * @since 2.4.2
 * @param source_file - Parsed TypeScript source file to inspect.
 * @param local_name - Local binding name to look for.
 * @returns Whether that local name is already declared in the file.
 */
export function has_top_level_binding(
  source_file: ts.SourceFile,
  local_name: string,
): boolean {
  return source_file.statements.some((stmt) =>
    collect_top_level_binding_names(stmt).includes(local_name)
  );
}

function collect_top_level_binding_names(stmt: ts.Statement): string[] {
  if (ts.isImportDeclaration(stmt)) {
    return collect_import_binding_names(stmt);
  }

  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.flatMap((decl) =>
      collect_binding_name_text(decl.name)
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
  ].flat().filter((name): name is string => name !== undefined);
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
