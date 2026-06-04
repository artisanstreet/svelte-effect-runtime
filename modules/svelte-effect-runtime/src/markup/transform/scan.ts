import { contains_top_level_yield_star } from "$/detect.ts";
import { AsyncEffectInEventCallbackError } from "$/error.ts";
import MagicString from "magic-string";
import ts from "typescript";

import {
  analyze_event_body_yield_star,
  strip_arrow_function,
} from "./expressions.ts";
import type { MarkupCandidate, TagKind } from "./types.ts";

interface SanitizeResult {
  code: string;
  candidates: MarkupCandidate[];
}

interface DeclarationInitializer {
  start: number;
  end: number;
  expr_text: string;
}

export function sanitize_markup(
  content: string,
  filename: string,
): SanitizeResult {
  const candidates: MarkupCandidate[] = [];
  const magic = new MagicString(content);
  let helper_index = 0;
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

    const declaration_initializers = collect_declaration_initializers(
      content,
      open,
      leading_ws,
      trimmed,
    );

    if (declaration_initializers.length > 0) {
      for (const initializer of declaration_initializers) {
        const placeholder = `__ser_markup_placeholder_${helper_index}`;
        helper_index += 1;

        candidates.push({
          placeholder,
          start: initializer.start,
          end: initializer.end,
          expr_text: initializer.expr_text,
          filename,
          key: "plain",
        });

        magic.overwrite(initializer.start, initializer.end, placeholder);
      }

      cursor = close + 1;
      continue;
    }

    let expr_body = trimmed.slice(tag_info.prefix_length);

    /** For @const, only use the RHS after `=` as the expression body. */
    const equal_idx = tag_info.kind === "plain" && trimmed.startsWith("@const ")
      ? expr_body.indexOf("=")
      : -1;

    /** Check if this is an event handler (arrow function containing yield*). */
    const is_event = is_event_expression(inner);

    /** Determine if this brace contains yield* that needs lowering. */
    const event_yield = is_event
      ? analyze_event_yield(inner, filename)
      : undefined;
    const has_yield = event_yield?.has_top_level_yield_star ??
      contains_yield_star_in_text(expr_body);

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

    const expr_start = open + 1 + leading_ws + tag_info.prefix_length +
      extra_prefix;

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
      filename,
      key,
    });

    magic.overwrite(
      expr_start,
      expr_end,
      key === "render" ? `${placeholder}()` : placeholder,
    );

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

/** Brace matching helpers for extracting complete markup expressions. */

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
  if (trimmed.startsWith("#each ")) {
    return { kind: "each", prefix_length: "#each ".length };
  }
  if (trimmed.startsWith("#await ")) {
    return { kind: "await", prefix_length: "#await ".length };
  }
  if (trimmed.startsWith("@render ")) {
    return { kind: "render", prefix_length: "@render ".length };
  }

  /** Strip prefix-only tags — the expression starts after the tag keyword. */
  if (trimmed.startsWith("#if ")) {
    return { kind: "plain", prefix_length: "#if ".length };
  }
  if (trimmed.startsWith(":else if ")) {
    return { kind: "plain", prefix_length: ":else if ".length };
  }
  if (trimmed.startsWith("#key ")) {
    return { kind: "plain", prefix_length: "#key ".length };
  }
  if (trimmed.startsWith("@const ")) {
    return { kind: "plain", prefix_length: "@const ".length };
  }
  if (trimmed.startsWith("@html ")) {
    return { kind: "plain", prefix_length: "@html ".length };
  }
  if (trimmed.startsWith("@debug ")) {
    return { kind: "plain", prefix_length: "@debug ".length };
  }

  return { kind: "plain", prefix_length: 0 };
}

function collect_declaration_initializers(
  content: string,
  open: number,
  leading_ws: number,
  trimmed: string,
): DeclarationInitializer[] {
  if (!is_declaration_tag_text(trimmed)) {
    return [];
  }

  const source_file = ts.createSourceFile(
    "declaration-tag.ts",
    `${trimmed};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const stmt = source_file.statements[0];

  if (!stmt || !ts.isVariableStatement(stmt)) {
    return [];
  }

  const tag_start = open + 1 + leading_ws;

  return stmt.declarationList.declarations
    .filter((decl) =>
      decl.initializer && contains_top_level_yield_star(decl.initializer)
    )
    .map((decl) => {
      const initializer = decl.initializer as ts.Expression;
      const start = tag_start + initializer.getStart(source_file);
      const end = tag_start + initializer.end;
      const expr_text = content.slice(start, end).trim();

      return {
        start,
        end,
        expr_text,
      };
    });
}

function is_declaration_tag_text(trimmed: string): boolean {
  return /^(?:const|let)\s/.test(trimmed);
}

function is_event_expression(inner: string): boolean {
  const trimmed = inner.trimStart();

  return /^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(trimmed);
}

function analyze_event_yield(
  inner: string,
  filename: string,
): {
  has_top_level_yield_star: boolean;
} {
  const event = strip_arrow_function(inner);
  const analysis = analyze_event_body_yield_star(event.body);

  if (analysis.has_nested_invalid_yield_star) {
    throw new AsyncEffectInEventCallbackError(filename, event.body);
  }

  return {
    has_top_level_yield_star: analysis.has_top_level_yield_star,
  };
}

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

/** Free identifier collection helpers for generated closures. */
