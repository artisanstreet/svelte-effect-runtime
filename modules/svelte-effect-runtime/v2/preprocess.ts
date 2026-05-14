import MagicString from "magic-string";
import ts from "typescript";
import { contains_top_level_yield_star } from "./detect.ts";

/**
 * Block reference emitted by the preprocessor to track what blocks were
 * generated in a given file.
 *
 * @since 2.0.0
 */
export interface BlockRef {
  /** Stable identifier for this block, used for cache lookups. */
  id: string;
  /** What kind of block was emitted. */
  kind: "value" | "promise" | "run" | "script";
}

/**
 * Result of the script preprocessor pass.
 *
 * @since 2.0.0
 */
export interface ScriptTransformResult {
  /** The transformed source code. */
  code: string;
  /** Block references emitted during transformation. */
  blocks: BlockRef[];
}

/**
 * Result of the markup preprocessor pass.
 *
 * @since 2.0.0
 */
export interface MarkupTransformResult {
  /** The transformed source code. */
  code: string;
  /** Whether any yield* expressions were found and lowered. */
  has_yield: boolean;
}

interface TempBinding {
  name: string;
}

interface LoweredStatement {
  temps: TempBinding[];
  rewritten_text: string;
  effect_assignments: string[];
  range: { start: number; end: number };
}

let temp_counter = 0;

function next_temp_name(hint?: string): string {
  const name = hint ? `__SER__${hint}` : `__SER__${temp_counter}`;
  temp_counter += 1;
  return name;
}

/**
 * Transforms a `<script effect>` body by extracting top-level `yield*`
 * expressions into `$state` temp bindings and wrapping the lowered
 * assignments in an `Effect.gen` block that runs on mount.
 *
 * @example
 * ```ts
 * const result = transform_script_effect(
 *   `let user = $state(yield* getUser(id));`,
 *   "App.svelte",
 * );
 * // result.code emits temp bindings, Effect.gen, and onMount + fork
 * ```
 *
 * @since 2.0.0
 * @param content - The raw `<script effect>` body content (without the
 *   `<script>` tags).
 * @param filename - The source filename, used in error messages.
 * @returns The transformed code and any block references.
 */
export function transform_script_effect(
  content: string,
  filename: string,
): ScriptTransformResult {
  temp_counter = 0;

  const source_file = ts.createSourceFile(
    filename,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const magic = new MagicString(content);
  const effect_assignments: string[] = [];
  let has_effect = false;
  const block_refs: BlockRef[] = [];
  let has_effect_import = false;

  for (const stmt of source_file.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      if (stmt.moduleSpecifier.text === "effect") {
        has_effect_import = true;
        break;
      }
    }
  }

  for (const stmt of source_file.statements) {
    if (contains_top_level_await(stmt)) {
      const text = slice(content, stmt);
      throw new Error(
        `${filename}: top-level await is not supported in <script effect>.\n` +
          `Use yield* Effect.promise(...) or yield* Effect.tryPromise(...) instead.\n\n` +
          `Problematic statement:\n${text}`,
      );
    }

    if (!contains_top_level_yield_star(stmt)) {
      continue;
    }

    has_effect = true;
    const lowered = lower_statement(stmt, content, filename);

    magic.overwrite(lowered.range.start, lowered.range.end, lowered.rewritten_text);

    if (lowered.temps.length > 0) {
      const prefix = lowered.temps
        .map((t) => `let ${t.name} = $state(undefined);`)
        .join("\n");
      magic.appendLeft(lowered.range.start, prefix + "\n");
    }

    effect_assignments.push(...lowered.effect_assignments);
  }

  if (!has_effect) {
    block_refs.push({ id: filename, kind: "script" });
    return { code: content, blocks: block_refs };
  }

  const imports = make_imports(has_effect_import);
  let insert_pos = 0;
  for (const stmt of [...source_file.statements].reverse()) {
    if (ts.isImportDeclaration(stmt)) {
      insert_pos = stmt.end;
      break;
    }
  }
  if (insert_pos > 0) {
    magic.appendRight(insert_pos, "\n" + imports);
  } else {
    magic.prepend(imports + "\n");
  }

  const runtime_block = make_runtime_block(effect_assignments);
  magic.append("\n" + runtime_block);

  block_refs.push({ id: filename, kind: "script" });
  return { code: magic.toString(), blocks: block_refs };
}

function make_imports(has_effect_import: boolean): string {
  const lines: string[] = [];
  lines.push(`import { onMount } from "svelte";`);
  if (!has_effect_import) {
    lines.push(`import { Effect } from "effect";`);
  }
  lines.push(
    `import { get_dispatcher } from "svelte-effect-runtime/v2/generators";`,
  );
  return lines.join("\n");
}

function make_runtime_block(assignments: string[]): string {
  const body = assignments.map((a) => `  ${a}`).join("\n");
  return [
    "",
    "const __SER__program = Effect.gen(function* () {",
    body,
    "});",
    "",
    "onMount(() => {",
    "  const __SER__dispatcher = get_dispatcher();",
    "  const __SER__cancel = __SER__dispatcher.fork(__SER__program);",
    "  import.meta.hot?.dispose(__SER__cancel);",
    "  return __SER__cancel;",
    "});",
    "",
  ].join("\n");
}

// ─── Statement lowering ──────────────────────────────────────

function lower_statement(
  stmt: ts.Statement,
  content: string,
  filename: string,
): LoweredStatement {
  if (ts.isExpressionStatement(stmt)) {
    return lower_expression_statement(stmt, content, filename);
  }
  if (ts.isVariableStatement(stmt)) {
    return lower_variable_statement(stmt, content, filename);
  }
  const text = slice(content, stmt);
  return {
    temps: [],
    rewritten_text: "",
    effect_assignments: [text],
    range: { start: stmt.getFullStart(), end: stmt.end },
  };
}

function lower_variable_statement(
  stmt: ts.VariableStatement,
  content: string,
  _filename: string,
): LoweredStatement {
  const temps: TempBinding[] = [];
  const rewritten_decls: string[] = [];
  const assignments: string[] = [];
  const decl_list = stmt.declarationList;
  const kind = (decl_list.flags & ts.NodeFlags.Let) !== 0 ? "let" : "const";
  let has_bare_yield = false;

  for (const decl of decl_list.declarations) {
    if (!decl.initializer || !contains_top_level_yield_star(decl.initializer)) {
      rewritten_decls.push(slice(content, decl).trim());
      continue;
    }

    const binding_text = slice(content, decl.name).trim();

    if (ts.isIdentifier(decl.name)) {
      const original_name = binding_text;
      const temp_name = next_temp_name(original_name);
      temps.push({ name: temp_name });

      if (is_yield_star_expression(decl.initializer)) {
        has_bare_yield = true;
        rewritten_decls.push(`${original_name} = $state(${temp_name})`);
      } else {
        const rewritten_expr = rewrite_expression_swapping_yield_star(
          decl.initializer, content, temp_name,
        );
        rewritten_decls.push(`${original_name} = ${rewritten_expr}`);
      }
      const yield_text = extract_yield_star_full_text(decl.initializer, content);
      assignments.push(`${temp_name} = ${yield_text};`);
    } else {
      has_bare_yield = true;
      const temp_name = next_temp_name("destructure");
      temps.push({ name: temp_name });
      const names = extract_binding_names(decl.name);
      for (const n of names) {
        temps.push({ name: n });
      }
      const rewritten_expr = rewrite_expression_swapping_yield_star(
        decl.initializer, content, temp_name,
      );
      rewritten_decls.push(`${binding_text} = ${rewritten_expr};`);
      const yield_text = extract_yield_star_full_text(decl.initializer, content);
      assignments.push(`${temp_name} = ${yield_text};`);
      assignments.push(`(${binding_text} = ${temp_name});`);
    }
  }

  const rewritten_text = rewritten_decls.length === 0
    ? ""
    : `${has_bare_yield ? "let" : kind} ${rewritten_decls.join(", ")};`;
  return {
    temps,
    rewritten_text,
    effect_assignments: assignments,
    range: { start: stmt.getStart(), end: stmt.end },
  };
}

function lower_expression_statement(
  stmt: ts.ExpressionStatement,
  content: string,
  _filename: string,
): LoweredStatement {
  const expr = stmt.expression;

  if (!contains_top_level_yield_star(expr)) {
    return {
      temps: [],
      rewritten_text: slice(content, stmt).trim(),
      effect_assignments: [],
      range: { start: stmt.getStart(), end: stmt.end },
    };
  }

  if (is_yield_star_expression(expr)) {
    const text = slice(content, expr).trim();
    return {
      temps: [],
      rewritten_text: "",
      effect_assignments: [text + ";"],
      range: { start: stmt.getFullStart(), end: stmt.end },
    };
  }

  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const target = slice(content, expr.left).trim();
    const temp_name = next_temp_name("assign");
    const temps: TempBinding[] = [{ name: temp_name }];
    const rewritten = `${target} = ${temp_name};`;
    const yield_text = extract_yield_star_full_text(expr, content);
    return {
      temps,
      rewritten_text: rewritten,
      effect_assignments: [`${temp_name} = ${yield_text};`],
      range: { start: stmt.getStart(), end: stmt.end },
    };
  }

  const temp_name = next_temp_name("call");
  const temps: TempBinding[] = [{ name: temp_name }];
  const rewritten = rewrite_expression_swapping_yield_star(expr, content, temp_name);
  const yield_text = extract_yield_star_full_text(expr, content);
  return {
    temps,
    rewritten_text: rewritten + ";",
    effect_assignments: [`${temp_name} = ${yield_text};`],
    range: { start: stmt.getStart(), end: stmt.end },
  };
}

// ─── Expression rewriting ────────────────────────────────────

function rewrite_expression_swapping_yield_star(
  expr: ts.Expression,
  content: string,
  temp_name: string,
): string {
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  collect_yield_star_replacements(expr, content, temp_name, replacements);

  if (replacements.length === 0) return slice(content, expr).trim();

  replacements.sort((a, b) => b.start - a.start);
  let text = slice(content, expr);
  for (const r of replacements) {
    const offset_in_expr = expr.getFullStart();
    text = text.slice(0, r.start - offset_in_expr) +
      r.text +
      text.slice(r.end - offset_in_expr);
  }
  return text.trim();
}

function collect_yield_star_replacements(
  node: ts.Node,
  content: string,
  temp_name: string,
  replacements: Array<{ start: number; end: number; text: string }>,
): void {
  if (is_function_boundary_node(node)) return;

  if (is_yield_star_expression(node)) {
    replacements.push({
      start: node.getStart(),
      end: node.end,
      text: temp_name,
    });
    return;
  }

  node.forEachChild((child) => {
    collect_yield_star_replacements(child, content, temp_name, replacements);
  });
}

function extract_yield_star_full_text(expr: ts.Expression, content: string): string {
  let found = "";
  find_yield_star_node(expr, (node) => {
    found = slice_start(content, node).trim();
  });
  return found || "undefined";
}

function find_yield_star_node(
  node: ts.Node,
  on_found: (node: ts.Node) => void,
): void {
  if (is_function_boundary_node(node)) return;

  if (is_yield_star_expression(node)) {
    on_found(node);
    return;
  }

  node.forEachChild((child) => {
    find_yield_star_node(child, on_found);
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function is_yield_star_expression(node: ts.Node): boolean {
  return ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
    ts.isIdentifier(node.left) &&
    node.left.text === "yield";
}

function is_function_boundary_node(node: ts.Node): boolean {
  return ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node);
}

function contains_top_level_await(node: ts.Node): boolean {
  if (ts.isAwaitExpression(node)) return true;
  return node.getChildren().some(
    (child) => !is_function_boundary_node(child) && contains_top_level_await(child),
  );
}

function extract_binding_names(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const result: string[] = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    result.push(...extract_binding_names(element.name));
  }
  return result;
}

function slice(content: string, node: ts.Node): string {
  return content.slice(node.getFullStart(), node.end);
}

function slice_start(content: string, node: ts.Node): string {
  return content.slice(node.getStart(), node.end);
}

/**
 * Transforms Svelte markup containing `{yield* expr}` brace expressions into
 * calls to the markup runtime helpers (`value`, `promise`, `run`).
 *
 * @example
 * ```ts
 * const result = transform_markup_effect(
 *   `<span>{yield* renderDate()}</span>`,
 *   "App.svelte",
 * );
 * // result.code contains <span>{value({ ... })}</span>
 * ```
 *
 * @since 2.0.0
 * @param content - The raw `.svelte` file content.
 * @param filename - The source filename, used in error messages.
 * @returns The transformed markup and a flag indicating whether yield* was
 *   found.
 */
export function transform_markup_effect(
  _content: string,
  _filename: string,
): MarkupTransformResult {
  throw new Error("not implemented yet");
}
