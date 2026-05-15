import { contains_top_level_yield_star } from "$/detect.ts";
import { TopLevelAwaitError } from "$/error.ts";

import MagicString from "magic-string";
import ts from "typescript";

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
 * Internal descriptor for a single `$state` temp variable that will be
 * emitted at component scope before the rewritten statement.
 */
interface TempBinding {
  name: string;
}

/**
 * Describes how a single statement was lowered: the rewritten source text,
 * the temp `$state` bindings to emit before it, and the effect-body
 * assignments that will run inside `Effect.gen`.
 */
interface LoweredStatement {
  /** `$state` bindings to emit at component scope. */
  temps: TempBinding[];
  /** The rewritten statement text with yield* replaced by temp refs. */
  rewritten_text: string;
  /** The assignments to emit in the effect body (includes `yield*`). */
  effect_assignments: string[];
  /** Original statement range to replace in the source. */
  range: { start: number; end: number };
}

/** Monotonically increasing counter for generating unique temp names. */
let temp_counter = 0;

/**
 * Generates the next `__SER__` temp binding name. When a hint is provided
 * the temp is named after the original variable (e.g. `__SER__user`),
 * otherwise a numeric index is used (`__SER__0`).
 *
 * @since 2.0.0
 * @param hint - Optional variable name to embed in the temp name.
 * @returns A unique `__SER__` prefixed identifier.
 */
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
 * The lowering rules are:
 *
 * 1. `$state(yield* expr)` — extract `yield* expr` to a temp, keep the
 *    `$state()` wrapper: `let __SER__x = $state(undefined);` +
 *    `let user = $state(__SER__x);` + `__SER__x = yield* expr;`
 *
 * 2. `const x = yield* expr` (bare sugar) — same but wraps in `$state()`:
 *    `let x = $state(__SER__x);`
 *
 * 3. `const {a, b} = yield* expr` — temp for the destructuring + individual
 *    `$state` per name + destructuring assignment in the effect body.
 *
 * 4. `yield* expr()` as a bare statement — moved into effect body verbatim.
 *
 * 5. `count = yield* expr` (assignment) — temp + `count = __SER__n` at
 *    component scope + `__SER__n = yield* expr` in effect body.
 *
 * @example
 * ```ts
 * const result = transform_script_effect(
 *   `let user = $state(yield* getUser(id));`,
 *   "App.svelte",
 * );
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
  const block_refs: BlockRef[] = [];

  let has_effect = false;

  /**
   * Phase 1 — detect whether the user already imports `Effect` so we
   * avoid emitting a duplicate `import { Effect } from "effect"`.
   */
  const has_effect_import = source_file.statements.some(
    (stmt) =>
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === "effect",
  );

  /**
   * Phase 2 — scan every statement. Statements containing top-level
   * `yield*` are lowered; everything else passes through unchanged.
   * Top-level `await` is rejected with a clear error.
   */
  for (const stmt of source_file.statements) {

    if (contains_top_level_await(stmt)) {
      const text = slice(content, stmt);
      throw new TopLevelAwaitError(filename, text);
    }

    if (!contains_top_level_yield_star(stmt)) {
      continue;
    }

    has_effect = true;
    const lowered = lower_statement(stmt, content, filename);

    magic.overwrite(
      lowered.range.start,
      lowered.range.end,
      lowered.rewritten_text,
    );

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

  /**
   * Phase 3 — inject runtime imports after the last user import.
   * If there are no existing imports, prepend to the file.
   */
  const imports = make_imports(has_effect_import);

  const last_import = [...source_file.statements]
    .reverse()
    .find(ts.isImportDeclaration);

  if (last_import) {
    magic.appendRight(last_import.end, "\n" + imports);
  } else {
    magic.prepend(imports + "\n");
  }

  /**
   * Phase 4 — append the `Effect.gen` + `onMount` + `fork` block at the
   * end of the script. This wraps all lowered assignments in a single
   * effect program that starts on mount and cancels on unmount or HMR.
   */
  const runtime_block = make_runtime_block(effect_assignments);
  magic.append("\n" + runtime_block);

  block_refs.push({ id: filename, kind: "script" });

  return { code: magic.toString(), blocks: block_refs };
}

/**
 * Builds the import statements injected by the preprocessor.
 *
 * `onMount` comes directly from Svelte. `Effect` comes from the `effect`
 * package (only if the user didn't already import it). `get_dispatcher`
 * comes from SER's own generators module.
 *
 * @since 2.0.0
 * @param has_effect_import - Whether the user already imports `Effect`.
 * @returns A string of newline-separated import statements.
 */
function make_imports(has_effect_import: boolean): string {
  return [
    `import { onMount } from "svelte";`,
    !has_effect_import && `import { Effect } from "effect";`,
    `import { get_dispatcher } from "svelte-effect-runtime/generators";`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Builds the `Effect.gen` + `onMount` + `fork` runtime block that wraps
 * all lowered effect assignments and wires them into the component
 * lifecycle via `onMount`.
 *
 * The generated code:
 *
 * 1. Creates `__SER__program` via `Effect.gen`.
 * 2. On mount, resolves the dispatcher, forks the program, and registers
 *    the cleanup both as the `onMount` return value and as an HMR dispose
 *    handler.
 *
 * @since 2.0.0
 * @param assignments - The effect-body assignment strings (e.g.
 *   `__SER__user = yield* getUser(id);`).
 * @returns The full runtime block as a string to append to the generated
 *   script.
 */
function make_runtime_block(assignments: string[]): string {
  const body = assignments
    .map((a) => `  ${a}`)
    .join("\n");

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

/**
 * Delegates a statement to the correct lowerer based on its syntax kind.
 * Variable statements and expression statements each have dedicated
 * lowering logic. Anything else falls through to the effect body as-is.
 *
 * @since 2.0.0
 * @param stmt - The statement to lower.
 * @param content - The original source text.
 * @param filename - Source filename for error messages.
 * @returns The lowered statement descriptor.
 */
function lower_statement(
  stmt: ts.Statement,
  content: string,
  filename: string,
): LoweredStatement {

  if (ts.isExpressionStatement(stmt)) {
    return lower_expression_statement(stmt, content);
  }

  if (ts.isVariableStatement(stmt)) {
    return lower_variable_statement(stmt, content);
  }

  const text = slice(content, stmt);

  return {
    temps: [],
    rewritten_text: "",
    effect_assignments: [text],
    range: { start: stmt.getFullStart(), end: stmt.end },
  };
}

/**
 * Lowers a variable statement containing `yield*` initializers.
 *
 * For each declaration in the declaration list:
 *
 * - **Simple identifier, bare yield*** (`const x = yield* expr`):
 *   emits a `$state` temp, rewrites to `let x = $state(temp)`, emits
 *   `temp = yield* expr` in the effect body.
 *
 * - **Simple identifier, wrapped** (`let x = $state(yield* expr)`):
 *   emits a temp, keeps the `$state(temp)` wrapper, emits the yield
 *   assignment.
 *
 * - **Destructuring** (`const {a, b} = yield* expr`):
 *   emits a temp + one `$state` per binding name, rewrites to
 *   `let {a, b} = temp`, emits the yield assignment followed by a
 *   destructuring assignment in the effect body.
 *
 * When any declaration has a bare `yield*` initializer (not wrapped in a
 * rune like `$state`), the entire statement is emitted with `let` even if
 * the user wrote `const`, because the binding is inherently reactive.
 *
 * @since 2.0.0
 * @param stmt - The variable statement to lower.
 * @param content - The original source text.
 * @returns The lowered statement descriptor.
 */
function lower_variable_statement(
  stmt: ts.VariableStatement,
  content: string,
): LoweredStatement {

  const temps: TempBinding[] = [];
  const rewritten_decls: string[] = [];
  const assignments: string[] = [];

  const decl_list = stmt.declarationList;
  const kind = (decl_list.flags & ts.NodeFlags.Let) !== 0 ? "let" : "const";
  let has_bare_yield = false;

  for (const decl of decl_list.declarations) {

    /**
     * Declarations without a `yield*` initializer keep their original
     * text and are hoisted to component scope unchanged.
     */
    if (!decl.initializer || !contains_top_level_yield_star(decl.initializer)) {
      rewritten_decls.push(slice(content, decl).trim());
      continue;
    }

    const binding_text = slice(content, decl.name).trim();

    if (ts.isIdentifier(decl.name)) {
      /**
       * Simple identifier binding.
       *
       *   const user = yield* getUser(id)
       *   let user = $state(yield* getUser(id))
       *
       * Both produce a temp `$state` binding. The difference is whether
       * we add our own `$state()` wrapper (bare case) or keep the user's
       * existing wrapper.
       */

      const original_name = binding_text;
      const temp_name = next_temp_name(original_name);

      temps.push({ name: temp_name });

      if (is_yield_star_expression(decl.initializer)) {
        /**
         * Bare `yield*` as the initializer — we must wrap the result in
         * `$state()` ourselves so the binding stays reactive.
         */
        has_bare_yield = true;
        rewritten_decls.push(`${original_name} = $state(${temp_name})`);
      } else {
        /**
         * Wrapped `yield*` — the user already placed `$state(yield* expr)`
         * or some other rune. Swap in the temp reference and keep
         * everything else intact.
         */
        const rewritten_expr = rewrite_expression_swapping_yield_star(
          decl.initializer,
          content,
          temp_name,
        );
        rewritten_decls.push(`${original_name} = ${rewritten_expr}`);
      }

      const yield_text = extract_yield_star_full_text(
        decl.initializer,
        content,
      );

      assignments.push(`${temp_name} = ${yield_text};`);

    } else {
      /**
       * Destructuring binding.
       *
       *   const { title, body } = yield* getPost(id)
       *
       * The yield result flows into a temp, then each destructured name
       * gets its own `$state` binding. The effect body first assigns the
       * yield result to the temp, then destructures from the temp.
       */

      has_bare_yield = true;

      const temp_name = next_temp_name("destructure");
      temps.push({ name: temp_name });

      const names = extract_binding_names(decl.name);

      temps.push({ name: temp_name });
      temps.push(...names.map((n) => ({ name: n })));

      const rewritten_expr = rewrite_expression_swapping_yield_star(
        decl.initializer,
        content,
        temp_name,
      );
      rewritten_decls.push(`${binding_text} = ${rewritten_expr};`);

      const yield_text = extract_yield_star_full_text(
        decl.initializer,
        content,
      );

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

/**
 * Lowers an expression statement containing `yield*`. Handles three
 * sub-patterns:
 *
 * - **Bare yield*** (`yield* logView(id);`) — moved into the effect body.
 * - **Assignment** (`count = yield* getCount()`) — temp binding extracted
 *   from the right-hand side.
 * - **Call expression** (`$inspect(yield* expr)`) — the `yield*` span is
 *   replaced with a temp reference.
 *
 * @since 2.0.0
 * @param stmt - The expression statement to lower.
 * @param content - The original source text.
 * @returns The lowered statement descriptor.
 */
function lower_expression_statement(
  stmt: ts.ExpressionStatement,
  content: string,
): LoweredStatement {

  const expr = stmt.expression;

  /** No yield* in this expression — pass through unchanged. */
  if (!contains_top_level_yield_star(expr)) {
    return {
      temps: [],
      rewritten_text: slice(content, stmt).trim(),
      effect_assignments: [],
      range: { start: stmt.getStart(), end: stmt.end },
    };
  }

  /** Bare `yield*` as a statement — fire and forget in the effect body. */
  if (is_yield_star_expression(expr)) {
    const text = slice(content, expr).trim();

    return {
      temps: [],
      rewritten_text: "",
      effect_assignments: [text + ";"],
      range: { start: stmt.getFullStart(), end: stmt.end },
    };
  }

  /** Assignment with `yield*` on the right-hand side. */
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    const target = slice(content, expr.left).trim();
    const temp_name = next_temp_name("assign");

    const yield_text = extract_yield_star_full_text(expr, content);

    return {
      temps: [{ name: temp_name }],
      rewritten_text: `${target} = ${temp_name};`,
      effect_assignments: [`${temp_name} = ${yield_text};`],
      range: { start: stmt.getStart(), end: stmt.end },
    };
  }

  /** Call expression wrapping `yield*` (e.g. `$inspect(yield* expr)`). */
  const temp_name = next_temp_name("call");

  const rewritten = rewrite_expression_swapping_yield_star(
    expr,
    content,
    temp_name,
  );

  const yield_text = extract_yield_star_full_text(expr, content);

  return {
    temps: [{ name: temp_name }],
    rewritten_text: rewritten + ";",
    effect_assignments: [`${temp_name} = ${yield_text};`],
    range: { start: stmt.getStart(), end: stmt.end },
  };
}

/**
 * Replaces every top-level `yield*` sub-expression inside the given
 * expression with a reference to `temp_name`. Returns the rewritten
 * expression text.
 *
 * Replacements are applied from right to left so that earlier source
 * offsets remain valid after each swap.
 *
 * @since 2.0.0
 * @param expr - The expression whose `yield*` spans should be swapped.
 * @param content - The original source text.
 * @param temp_name - The `$state` temp variable name to swap in.
 * @returns The rewritten expression text.
 */
function rewrite_expression_swapping_yield_star(
  expr: ts.Expression,
  content: string,
  temp_name: string,
): string {

  const replacements: Array<{
    start: number;
    end: number;
    text: string;
  }> = [];

  collect_yield_star_replacements(expr, content, temp_name, replacements);

  if (replacements.length === 0) {
    return slice(content, expr).trim();
  }

  replacements.sort((a, b) => b.start - a.start);

  let text = slice(content, expr);

  const offset_in_expr = expr.getFullStart();

  for (const r of replacements) {
    text =
      text.slice(0, r.start - offset_in_expr) +
      r.text +
      text.slice(r.end - offset_in_expr);
  }

  return text.trim();
}

/**
 * Recursively walks the AST of an expression, collecting every top-level
 * `yield*` expression (skipping function boundaries) and recording its
 * source range so it can be replaced.
 *
 * @since 2.0.0
 * @param node - The AST node to walk.
 * @param content - The original source text.
 * @param temp_name - The temp name to use in replacements.
 * @param replacements - Accumulator array for replacement descriptors.
 */
function collect_yield_star_replacements(
  node: ts.Node,
  _content: string,
  temp_name: string,
  replacements: Array<{ start: number; end: number; text: string }>,
): void {

  if (is_function_boundary_node(node)) {
    return;
  }

  if (is_yield_star_expression(node)) {
    replacements.push({
      start: node.getStart(),
      end: node.end,
      text: temp_name,
    });
    return;
  }

  node.forEachChild((child) => {
    collect_yield_star_replacements(child, _content, temp_name, replacements);
  });
}

/**
 * Finds the first top-level `yield*` expression in the given expression
 * and returns its full source text (e.g. `yield* getUser(id)`).
 *
 * Uses `slice_start` to exclude leading whitespace trivia when extracting
 * the yield text.
 *
 * @since 2.0.0
 * @param expr - The expression to search.
 * @param content - The original source text.
 * @returns The full `yield*` source text, or `"undefined"` if none found.
 */
function extract_yield_star_full_text(
  expr: ts.Expression,
  content: string,
): string {

  let found: string | undefined;

  find_yield_star_node(expr, (node) => {
    found = slice_start(content, node).trim();
  });

  return found ?? "undefined";
}

/**
 * Walks an expression AST and invokes the callback with the first
 * top-level `yield*` expression node found (skipping function boundaries).
 *
 * @since 2.0.0
 * @param node - The AST node to search.
 * @param on_found - Callback invoked with the first `yield*` node found.
 */
function find_yield_star_node(
  node: ts.Node,
  on_found: (node: ts.Node) => void,
): void {

  if (is_function_boundary_node(node)) {
    return;
  }

  if (is_yield_star_expression(node)) {
    on_found(node);
    return;
  }

  node.forEachChild((child) => {
    find_yield_star_node(child, on_found);
  });
}

/**
 * Checks whether the node is a `yield*` binary expression
 * (`yield * operand`).
 *
 * @since 2.0.0
 * @param node - The TypeScript AST node to check.
 * @returns Whether the node represents a `yield*` expression.
 */
function is_yield_star_expression(node: ts.Node): boolean {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
    ts.isIdentifier(node.left) &&
    node.left.text === "yield"
  );
}

/**
 * Checks whether the node is a function-like AST node that owns its own
 * yield/yield* semantics. Mirrors {@link is_function_boundary} from
 * `detect.ts` to keep the preprocessor self-contained.
 *
 * @since 2.0.0
 * @param node - The TypeScript AST node to check.
 * @returns Whether the node is a function boundary.
 */
function is_function_boundary_node(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/**
 * Returns `true` if the node tree contains a top-level `await` expression
 * (not inside a function boundary).
 *
 * @since 2.0.0
 * @param node - The root node to search from.
 * @returns Whether a top-level `await` expression was found.
 */
function contains_top_level_await(node: ts.Node): boolean {
  if (ts.isAwaitExpression(node)) {
    return true;
  }

  return node.getChildren().some(
    (child) =>
      !is_function_boundary_node(child) && contains_top_level_await(child),
  );
}

/**
 * Extracts the identifier names from a TypeScript binding name. Handles
 * simple identifiers (`x`) and destructuring patterns (`{a, b}` or
 * `[a, b]`).
 *
 * @since 2.0.0
 * @param name - The binding name node.
 * @returns Array of identifier name strings.
 */
function extract_binding_names(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  const result: string[] = [];

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }
    result.push(...extract_binding_names(element.name));
  }

  return result;
}

/**
 * Slices a substring of `content` matching the node's full source range
 * (including leading trivia such as whitespace and comments).
 *
 * @since 2.0.0
 * @param content - The original source text.
 * @param node - The AST node whose full range to extract.
 * @returns The source text for the node, including leading trivia.
 */
function slice(content: string, node: ts.Node): string {
  return content.slice(node.getFullStart(), node.end);
}

/**
 * Slices a substring of `content` matching the node's source range without
 * leading trivia (whitespace/comments).
 *
 * @since 2.0.0
 * @param content - The original source text.
 * @param node - The AST node whose start range to extract.
 * @returns The source text for the node, excluding leading trivia.
 */
function slice_start(content: string, node: ts.Node): string {
  return content.slice(node.getStart(), node.end);
}

export { type MarkupTransformResult, transform_markup_effect } from "./markup/transform.ts";
