import ts from "typescript";

/**
 * Builds the import statements injected by the script preprocessor.
 *
 * @since 2.0.0
 * @param has_effect_import - Whether the user already imports `Effect`.
 * @param has_dispatcher_import - Whether the user already imports
 *   `get_dispatcher`.
 * @returns Newline-separated import statements to inject.
 */
export function make_imports(
  has_effect_import: boolean,
  has_dispatcher_import: boolean,
): string {
  return [
    !has_effect_import && `import { Effect } from "effect";`,
    !has_dispatcher_import &&
    `import { get_dispatcher } from "svelte-effect-runtime/internal/generators";`,
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

    if (!clause) {
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
      (element) => element.name.text === local_name,
    );
  });
}
