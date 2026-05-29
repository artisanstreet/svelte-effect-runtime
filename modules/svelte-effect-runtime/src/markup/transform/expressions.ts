import ts from "typescript";

/**
 * Strips an event handler arrow function down to its executable body.
 *
 * @since 2.0.0
 * @param expr - Event handler expression text from the original markup.
 * @returns Handler parameters, body text, and body offsets inside `expr`.
 */
export function strip_arrow_function(
  expr: string,
): { params: string; body: string; body_start: number; body_end: number } {
  const arrow_idx = expr.indexOf("=>");

  if (arrow_idx === -1) {
    return { params: "()", body: expr, body_start: 0, body_end: expr.length };
  }

  const params = expr.slice(0, arrow_idx).trim();
  const raw_body = expr.slice(arrow_idx + 2);
  const leading_ws = raw_body.length - raw_body.trimStart().length;
  let body_start = arrow_idx + 2 + leading_ws;
  let body_end = expr.length - (raw_body.length - raw_body.trimEnd().length);
  let body = expr.slice(body_start, body_end);

  if (body.startsWith("{") && body.endsWith("}")) {
    body_start += 1;
    body_end -= 1;
    body = body.slice(1, -1);
  }

  const body_leading_ws = body.length - body.trimStart().length;
  const body_trailing_ws = body.length - body.trimEnd().length;

  body_start += body_leading_ws;
  body_end -= body_trailing_ws;
  body = body.trim();

  if (body.endsWith(";")) {
    body = body.slice(0, -1);
    body_end -= 1;
  }

  return { params, body, body_start, body_end };
}

/**
 * Collects free identifiers that must be captured as reactive dependencies.
 *
 * @since 2.0.0
 * @param expr_text - Markup expression text to inspect.
 * @returns Identifier names referenced by the expression.
 */
export function collect_free_identifiers(expr_text: string): string[] {
  const wrapped = `function* __w() { return (${expr_text}); }`;
  let sf: ts.SourceFile;

  try {
    sf = ts.createSourceFile(
      "expr.ts",
      wrapped,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
  } catch {
    return [];
  }

  const fn = sf.statements[0];

  if (!ts.isFunctionDeclaration(fn) || !fn.body) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  visit_ids(fn.body, seen, ids);

  return ids;
}

function visit_ids(
  node: ts.Node,
  seen: Set<string>,
  ids: string[],
): void {
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  ) {
    return;
  }

  if (ts.isIdentifier(node)) {
    if (
      node.text === "yield" ||
      node.text === "undefined" ||
      node.text === "null" ||
      node.text === "true" ||
      node.text === "false" ||
      node.text === "this"
    ) {
      return;
    }

    if (is_property_access_name(node)) {
      return;
    }

    if (!seen.has(node.text)) {
      seen.add(node.text);
      ids.push(node.text);
    }
    return;
  }

  node.forEachChild((child) => visit_ids(child, seen, ids));
}

function is_property_access_name(node: ts.Identifier): boolean {
  const parent = node.parent;

  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent)
  );
}
