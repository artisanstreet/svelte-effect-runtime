import MagicString from "magic-string";
import { type AST, parse } from "svelte/compiler";
import ts from "typescript";
import { contains_top_level_yield_star } from "$/detect.ts";

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

/** Describes a brace expression that contains yield* and needs lowering. */
interface MarkupCandidate {
  /** The placeholder identifier injected into the sanitized markup. */
  placeholder: string;
  /** Start offset of the expression in the original source. */
  start: number;
  /** End offset of the expression in the original source. */
  end: number;
  /** The expression text (without surrounding braces). */
  expr_text: string;
  /** Whether this expression is a key context (each/promise/render key). */
  key: string;
}

type TagKind = "plain" | "each" | "await" | "event" | "render";

const HELPERS = {
  value: "__ser_markup_value",
  promise: "__ser_markup_promise",
  run: "__ser_markup_run",
} as const;

let helper_index = 0;

/**
 * Transforms Svelte markup containing `{yield* expr}` brace expressions
 * into calls to the markup runtime helpers (`value`, `promise`, `run`).
 *
 * Strategy: first find all brace expressions containing `yield*` via
 * character scanning, replace them with placeholder identifiers, then
 * parse the sanitized markup with Svelte's AST to determine the correct
 * context for each placeholder (plain expression, #each, #await, event
 * handler, etc.).
 *
 * @since 2.0.0
 * @param content - The raw `.svelte` file content.
 * @param filename - The source filename, used in error messages.
 * @returns The transformed markup and a flag indicating whether yield* was
 *   found.
 */
export function transform_markup_effect(
  content: string,
  filename: string,
): MarkupTransformResult {

  if (!/\byield\s*\*/.test(content)) {
    return { code: content, has_yield: false };
  }

  /** Find all brace expressions containing yield* and replace with placeholders. */
  const work = sanitize_markup(content);

  if (work.candidates.length === 0) {
    return { code: content, has_yield: false };
  }

  /** Parse the sanitized markup with Svelte's AST. */
  const ast = parse(work.code, { filename, modern: true });

  /** Match placeholders to their AST context and build replacements. */
  const replacements = collect_replacements(
    ast,
    work.candidates,
  );

  const magic = new MagicString(content);

  replacements.sort((a, b) => b.start - a.start);

  for (const r of replacements) {
    magic.overwrite(r.start, r.end, r.text);
  }

  inject_helpers(magic, content);

  return { code: magic.toString(), has_yield: true };
}

// ─── Sanitization ────────────────────────────────────────────

interface SanitizeResult {
  code: string;
  candidates: MarkupCandidate[];
}

function sanitize_markup(content: string): SanitizeResult {
  helper_index = 0;
  const candidates: MarkupCandidate[] = [];
  const magic = new MagicString(content);
  let cursor = 0;

  while (cursor < content.length) {
    const open = content.indexOf("{", cursor);
    if (open === -1) break;

    /** Skip braces inside <script> and <style> blocks. */
    if (is_inside_excluded_block(content, open)) {
      cursor = open + 1;
      continue;
    }

    /** Find the matching closing brace. */
    const close = find_closing_brace(content, open + 1);
    if (close === -1) {
      cursor = open + 1;
      continue;
    }

    const inner = content.slice(open + 1, close);

    const trimmed = inner.trimStart();
    const leading_ws = inner.length - trimmed.length;

    const tag_info = get_tag_info(trimmed);

    let expr_body = trimmed.slice(tag_info.prefix_length);

    /** For @const, only use the RHS after `=` as the expression body. */
    const equal_idx = tag_info.kind === "plain" && trimmed.startsWith("@const ")
      ? expr_body.indexOf("=")
      : -1;

    /** Check if this is an event handler (arrow function containing yield*). */
    const is_event = is_event_expression(inner);

    /** Determine if this brace contains yield* that needs lowering. */
    const has_yield =
      is_event
        ? /\byield\s*\*/.test(inner)
        : contains_yield_star_in_text(expr_body);

    if (!has_yield) {
      cursor = close + 1;
      continue;
    }

    /** The expression starts after the tag prefix. For @const, after the `=`. */
    let extra_prefix = 0;

    if (equal_idx !== -1) {
      const after_eq_raw = expr_body.slice(equal_idx + 1);
      expr_body = after_eq_raw.trimStart();
      extra_prefix = equal_idx + 1 + (after_eq_raw.length - expr_body.length);
    }

    const expr_start = open + 1 + leading_ws + tag_info.prefix_length + extra_prefix;

    /** For each/await, the expression ends before ` as ` or ` then `/` catch `. */
    let expr_end = close;

    const key = tag_info.kind;

    if (key === "each") {
      const as_idx = expr_body.lastIndexOf(" as ");
      if (as_idx !== -1) expr_end = expr_start + as_idx;
    }

    if (key === "await") {
      const then_idx = expr_body.indexOf(" then ");
      const catch_idx = expr_body.indexOf(" catch ");
      const boundary = Math.min(
        then_idx === -1 ? Infinity : then_idx,
        catch_idx === -1 ? Infinity : catch_idx,
      );
      if (boundary !== Infinity) expr_end = expr_start + boundary;
    }

    const expr_text = content.slice(expr_start, expr_end).trim();

    if (expr_text.length === 0) {
      cursor = close + 1;
      continue;
    }

    /** Create a placeholder and replace the expression (preserving tag prefixes). */
    const placeholder = `__ser_markup_placeholder_${helper_index}`;
    helper_index += 1;

    candidates.push({
      placeholder,
      start: expr_start,
      end: expr_end,
      expr_text,
      key,
    });

    magic.overwrite(expr_start, expr_end, key === "render" ? `${placeholder}()` : placeholder);

    cursor = close + 1;
  }

  return { code: magic.toString(), candidates };
}

function is_inside_excluded_block(content: string, pos: number): boolean {
  const script = find_tag_end(content, "script", pos);
  const style = find_tag_end(content, "style", pos);

  return (
    (script !== undefined && pos < script.end && pos > script.start) ||
    (style !== undefined && pos < style.end && pos > style.start)
  );
}

function find_tag_end(
  content: string,
  tag: string,
  after_pos: number,
): { start: number; end: number } | undefined {

  const pattern = new RegExp(
    `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,
    "gi",
  );

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const end_pos = match.index + match[0].length;
    if (match.index <= after_pos && after_pos < end_pos) {
      return { start: match.index, end: end_pos };
    }
  }

  return undefined;
}

// ─── Brace matching ──────────────────────────────────────────

function find_closing_brace(content: string, start: number): number {
  let depth = 0;

  for (let i = start; i < content.length; i += 1) {
    const ch = content[i];

    if (ch === "{" && content[i - 1] !== "$") {
      depth += 1;
    } else if (ch === "}") {
      if (depth === 0) return i;
      depth -= 1;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      i = skip_string(content, i, ch);
      if (i === -1) return -1;
    } else if (ch === "/" && content[i + 1] === "/") {
      i = skip_line_comment(content, i);
    } else if (ch === "/" && content[i + 1] === "*") {
      i = skip_block_comment(content, i);
      if (i === -1) return -1;
    }
  }

  return -1;
}

function skip_string(content: string, start: number, quote: string): number {
  for (let i = start + 1; i < content.length; i += 1) {
    if (content[i] === "\\") {
      i += 1;
      continue;
    }
    if (content[i] === quote) return i;
  }
  return -1;
}

function skip_line_comment(content: string, start: number): number {
  for (let i = start + 2; i < content.length; i += 1) {
    if (content[i] === "\n") return i;
  }
  return content.length;
}

function skip_block_comment(content: string, start: number): number {
  for (let i = start + 2; i < content.length; i += 1) {
    if (content[i] === "*" && content[i + 1] === "/") return i + 1;
  }
  return -1;
}

interface TagInfo {
  kind: TagKind;
  prefix_length: number;
}

function get_tag_info(trimmed: string): TagInfo {
  if (trimmed.startsWith("#each ")) return { kind: "each", prefix_length: "#each ".length };
  if (trimmed.startsWith("#await ")) return { kind: "await", prefix_length: "#await ".length };
  if (trimmed.startsWith("@render ")) return { kind: "render", prefix_length: "@render ".length };

  /** Strip prefix-only tags — the expression starts after the tag keyword. */
  if (trimmed.startsWith("#if ")) return { kind: "plain", prefix_length: "#if ".length };
  if (trimmed.startsWith(":else if ")) return { kind: "plain", prefix_length: ":else if ".length };
  if (trimmed.startsWith("#key ")) return { kind: "plain", prefix_length: "#key ".length };
  if (trimmed.startsWith("@const ")) return { kind: "plain", prefix_length: "@const ".length };
  if (trimmed.startsWith("@html ")) return { kind: "plain", prefix_length: "@html ".length };
  if (trimmed.startsWith("@debug ")) return { kind: "plain", prefix_length: "@debug ".length };

  return { kind: "plain", prefix_length: 0 };
}

function is_event_expression(inner: string): boolean {
  const trimmed = inner.trimStart();
  return trimmed.startsWith("(") && /\)\s*=>/.test(trimmed);
}

// ─── AST replacement collection ──────────────────────────────

interface Replacement {
  start: number;
  end: number;
  text: string;
}

function collect_replacements(
  ast: AST.Root,
  candidates: MarkupCandidate[],
): Replacement[] {

  const by_placeholder = new Map(
    candidates.map((c) => [c.placeholder, c]),
  );

  const replacements: Replacement[] = [];
  const matched = new Set<string>();

  walk_ast(ast.fragment, by_placeholder, matched, replacements);

  return replacements;
}

function walk_ast(
  fragment: AST.Fragment,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  replacements: Replacement[],
): void {
  for (const node of fragment.nodes) {
    visit_ast_node(node, candidates, matched, replacements);
  }
}

function visit_ast_node(
  node: AST.Fragment["nodes"][number],
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  replacements: Replacement[],
): void {

  switch (node.type) {
    case "ExpressionTag":
      emit_for_expression(
        node.expression,
        "plain",
        candidates,
        matched,
        replacements,
      );
      return;

    case "IfBlock":
      emit_for_expression(
        node.test,
        "plain",
        candidates,
        matched,
        replacements,
      );
      walk_ast(node.consequent, candidates, matched, replacements);
      if (node.alternate) {
        walk_ast(node.alternate, candidates, matched, replacements);
      }
      return;

    case "EachBlock":
      emit_for_expression(
        node.expression,
        "each",
        candidates,
        matched,
        replacements,
      );
      walk_ast(node.body, candidates, matched, replacements);
      if (node.fallback) {
        walk_ast(node.fallback, candidates, matched, replacements);
      }
      return;

    case "AwaitBlock":
      emit_for_expression(
        node.expression,
        "await",
        candidates,
        matched,
        replacements,
      );
      if (node.pending) walk_ast(node.pending, candidates, matched, replacements);
      if (node.then) walk_ast(node.then, candidates, matched, replacements);
      if (node.catch) walk_ast(node.catch, candidates, matched, replacements);
      return;

    case "RenderTag":
      emit_for_expression(
        node.expression,
        "render",
        candidates,
        matched,
        replacements,
      );
      return;

    case "ConstTag": {
      const decl = node.declaration.declarations[0];
      if (decl?.init) {
        emit_for_expression(
          decl.init,
          "plain",
          candidates,
          matched,
          replacements,
        );
      }
      return;
    }

    case "KeyBlock":
      emit_for_expression(
        node.expression,
        "plain",
        candidates,
        matched,
        replacements,
      );
      walk_ast(node.fragment, candidates, matched, replacements);
      return;

    case "RegularElement":
    case "Component":
    case "TitleElement":
    case "SlotElement":
    case "SvelteBody":
    case "SvelteBoundary":
    case "SvelteComponent":
    case "SvelteDocument":
    case "SvelteElement":
    case "SvelteFragment":
    case "SvelteHead":
    case "SvelteSelf":
    case "SvelteWindow":
      visit_element_attributes(node, candidates, matched, replacements);
      walk_ast(node.fragment, candidates, matched, replacements);
      return;

    default:
      return;
  }
}

interface ElementLikeNode {
  attributes: Array<{
    type: string;
    name?: string;
    value?: unknown;
    expression?: unknown;
  }>;
  fragment: AST.Fragment;
}

function visit_element_attributes(
  node: ElementLikeNode,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  replacements: Replacement[],
): void {
  for (const attr of node.attributes) {
    if (
      attr.type === "Attribute" &&
      attr.name &&
      (attr.name.startsWith("on:") || /^on[a-z]/.test(attr.name))
    ) {
      visit_attribute_value(
        attr.value,
        "event",
        candidates,
        matched,
        replacements,
      );
      continue;
    }

    if (attr.type === "OnDirective" && attr.expression) {
      emit_for_expression(
        attr.expression,
        "event",
        candidates,
        matched,
        replacements,
      );
      continue;
    }
  }
}

function visit_attribute_value(
  value: true | AST.ExpressionTag | Array<AST.Text | AST.ExpressionTag>,
  kind: TagKind,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  replacements: Replacement[],
): void {
  if (value === true) return;

  if (Array.isArray(value)) {
    for (const part of value) {
      if (part.type === "ExpressionTag") {
        emit_for_expression(part.expression, kind, candidates, matched, replacements);
      }
    }
    return;
  }

  emit_for_expression(value.expression, kind, candidates, matched, replacements);
}

function emit_for_expression(
  expression: { type: string; name?: string; callee?: { type: string; name?: string } } | null | undefined,
  kind: TagKind,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  replacements: Replacement[],
): void {
  if (!expression) return;

  const candidate = find_candidate(expression, candidates);
  if (!candidate || matched.has(candidate.placeholder)) return;

  matched.add(candidate.placeholder);

  const id = candidate.placeholder;
  const deps = collect_free_identifiers(candidate.expr_text);
  const deps_text = deps.length === 0 ? "[]" : `[${deps.join(", ")}]`;

  let replacement_text: string;

  if (kind === "await") {
    replacement_text = `${HELPERS.promise}("${id}", ${deps_text}, function* () { return (${candidate.expr_text}); })`;
  } else if (kind === "render") {
    replacement_text = `(${HELPERS.value}("${id}", ${deps_text}, function () {}, function* () { return (${candidate.expr_text}); }))()`;
  } else if (kind === "each") {
    replacement_text = `${HELPERS.value}("${id}", ${deps_text}, [], function* () { return (${candidate.expr_text}); })`;
  } else if (kind === "event") {
    replacement_text = `() => { void ${HELPERS.run}(function* () { return (${candidate.expr_text}); }); }`;
  } else {
    replacement_text = `${HELPERS.value}("${id}", ${deps_text}, undefined, function* () { return (${candidate.expr_text}); })`;
  }

  replacements.push({
    start: candidate.start,
    end: candidate.end,
    text: replacement_text,
  });
}

function find_candidate(
  expression: {
    type: string;
    name?: string;
    callee?: { type: string; name?: string };
  },
  candidates: Map<string, MarkupCandidate>,
): MarkupCandidate | undefined {
  if (expression.type === "Identifier" && expression.name) {
    return candidates.get(expression.name);
  }
  if (
    expression.type === "CallExpression" &&
    expression.callee?.type === "Identifier" &&
    expression.callee.name
  ) {
    return candidates.get(expression.callee.name);
  }
  return undefined;
}

// ─── Helpers ─────────────────────────────────────────────────

function contains_yield_star_in_text(text: string): boolean {
  if (!/\byield\s*\*/.test(text)) return false;

  try {
    const sf = ts.createSourceFile(
      "expr.ts",
      `const x = ${text};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const stmt = sf.statements[0];
    if (!ts.isVariableStatement(stmt)) return false;
    const decl = stmt.declarationList.declarations[0];
    if (!decl?.initializer) return false;
    return contains_top_level_yield_star(decl.initializer);
  } catch {
    return true;
  }
}

// ─── Free identifier collection ──────────────────────────────

function collect_free_identifiers(expr_text: string): string[] {
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
  if (!ts.isFunctionDeclaration(fn) || !fn.body) return [];

  const ids: string[] = [];
  const seen = new Set<string>();

  visit_ids(fn, seen, ids);

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

    if (is_property_access_name(node)) return;

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

// ─── Import injection ────────────────────────────────────────

function inject_helpers(magic: MagicString, content: string): void {
  if (content.includes(`"svelte-effect-runtime/generators"`)) return;

  const helper_block = [
    `import { value as ${HELPERS.value} } from "svelte-effect-runtime/generators";`,
    `import { promise as ${HELPERS.promise} } from "svelte-effect-runtime/generators";`,
    `import { run as ${HELPERS.run} } from "svelte-effect-runtime/generators";`,
  ].join("\n");

  const script_tag = find_instance_script_tag(content);

  if (script_tag) {
    magic.appendLeft(script_tag.end, `\n${helper_block}\n`);
  } else {
    magic.prepend(`<script>\n${helper_block}\n</script>\n\n`);
  }
}

function find_instance_script_tag(
  content: string,
): { start: number; end: number } | undefined {
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;

    const attrs = match[1] ?? "";
    if (
      /\bcontext\s*=\s*["']module["']/.test(attrs) ||
      /\bmodule\b/.test(attrs)
    ) {
      continue;
    }

    const open_end = match[0].indexOf(">") + 1;
    return {
      start: match.index + open_end,
      end: match.index + match[0].length - "</script>".length,
    };
  }

  return undefined;
}
