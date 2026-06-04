import { collect_free_identifiers } from "$/markup/transform/expressions.ts";
import { contains_top_level_yield_star } from "$/detect.ts";
import {
  collect_yield_star_nodes,
  extract_binding_names,
  find_yield_star_node,
  is_yield_star_expression,
} from "./ast.ts";
import { get_state_rune_initializer } from "./runes.ts";
import { slice, slice_start } from "./source.ts";
import type {
  EffectBlock,
  LoweredExpression,
  LoweredStatement,
  ScriptLoweringContext,
  TempBinding,
} from "./types.ts";

import ts from "typescript";

/**
 * Delegates a statement to the correct lowerer based on syntax kind.
 *
 * @since 2.0.0
 * @param stmt - Statement to lower.
 * @param content - Original source text.
 * @param context - Lowering services for this transform pass.
 * @returns Lowered statement descriptor.
 */
export function lower_statement(
  stmt: ts.Statement,
  content: string,
  context: ScriptLoweringContext,
): LoweredStatement {
  if (ts.isExpressionStatement(stmt)) {
    return lower_expression_statement(stmt, content, context);
  }

  if (ts.isVariableStatement(stmt)) {
    return lower_variable_statement(stmt, content, context);
  }

  const text = slice(content, stmt);

  return {
    temps: [],
    rewritten_text: "",
    effect_blocks: [make_effect_block([text], collect_deps(text))],
    range: { start: stmt.getFullStart(), end: stmt.end },
  };
}

function lower_variable_statement(
  stmt: ts.VariableStatement,
  content: string,
  context: ScriptLoweringContext,
): LoweredStatement {
  const temps: TempBinding[] = [];
  const rewritten_decls: string[] = [];
  const statements: string[] = [];
  const deps: string[] = [];

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

      if (is_yield_star_expression(decl.initializer)) {
        const temp_name = context.next_temp_name(original_name);

        temps.push({ name: temp_name });
        has_bare_yield = true;
        rewritten_decls.push(`${original_name} = $derived(${temp_name})`);

        const yield_text = extract_yield_star_full_text(
          decl.initializer,
          content,
        );

        statements.push(`${temp_name} = ${yield_text};`);
        deps.push(...collect_deps(yield_text));
      } else {
        const state_rune = get_state_rune_initializer(
          decl.initializer,
          content,
        );

        if (state_rune) {
          has_bare_yield = true;
          rewritten_decls.push(
            `${original_name} = ${state_rune.rune_name}(undefined)`,
          );
          statements.push(`${original_name} = ${state_rune.value_text};`);
          deps.push(...collect_deps(state_rune.value_text));
          continue;
        }

        const lowered = lower_expression_yields(
          decl.initializer,
          content,
          original_name,
          context,
        );

        temps.push(...lowered.temps);
        for (const block of lowered.effect_blocks) {
          statements.push(...block.statements);
          deps.push(...block.deps);
        }

        const rewritten_expr = rewrite_state_rune_as_derived(
          lowered.rewritten_expr,
        );

        rewritten_decls.push(`${original_name} = ${rewritten_expr}`);
      }
    } else {
      has_bare_yield = true;

      const temp_name = context.next_temp_name("destructure");
      const names = extract_binding_names(decl.name);

      temps.push({ name: temp_name });
      temps.push(...names.map((name) => ({ name })));

      const yield_text = extract_yield_star_full_text(
        decl.initializer,
        content,
      );

      statements.push(`${temp_name} = ${yield_text};`);
      statements.push(`(${binding_text} = ${temp_name});`);
      deps.push(...collect_deps(yield_text));
    }
  }

  const rewritten_text = rewritten_decls.length === 0
    ? ""
    : `${has_bare_yield ? "let" : kind} ${rewritten_decls.join(", ")};`;

  return {
    temps,
    rewritten_text,
    effect_blocks: statements.length === 0
      ? []
      : [make_effect_block(statements, deps)],
    range: { start: stmt.getStart(), end: stmt.end },
  };
}

function lower_expression_statement(
  stmt: ts.ExpressionStatement,
  content: string,
  context: ScriptLoweringContext,
): LoweredStatement {
  const expr = stmt.expression;

  if (!contains_top_level_yield_star(expr)) {
    return {
      temps: [],
      rewritten_text: slice(content, stmt).trim(),
      effect_blocks: [],
      range: { start: stmt.getStart(), end: stmt.end },
    };
  }

  if (is_yield_star_expression(expr)) {
    const text = slice(content, expr).trim();

    return {
      temps: [],
      rewritten_text: "",
      effect_blocks: [make_effect_block([text + ";"], collect_deps(text))],
      range: { start: stmt.getFullStart(), end: stmt.end },
    };
  }

  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    const target = slice(content, expr.left).trim();
    const yield_text = extract_yield_star_full_text(expr, content);

    return {
      temps: [],
      rewritten_text: "",
      effect_blocks: [
        make_effect_block(
          [`${target} = ${yield_text};`],
          collect_deps(yield_text),
        ),
      ],
      range: { start: stmt.getStart(), end: stmt.end },
    };
  }

  const lowered = lower_expression_yields(
    expr,
    content,
    "call",
    context,
  );

  return {
    temps: lowered.temps,
    rewritten_text: lowered.rewritten_expr + ";",
    effect_blocks: lowered.effect_blocks,
    range: { start: stmt.getStart(), end: stmt.end },
  };
}

function lower_expression_yields(
  expr: ts.Expression,
  content: string,
  hint: string,
  context: ScriptLoweringContext,
): LoweredExpression {
  const replacements: Array<{
    start: number;
    end: number;
    text: string;
  }> = [];

  const temps: TempBinding[] = [];
  const statements: string[] = [];
  const deps: string[] = [];

  collect_yield_star_nodes(expr, (node) => {
    const temp_name = context.next_temp_name(hint);
    const yield_text = slice_start(content, node).trim();

    temps.push({ name: temp_name });
    statements.push(`${temp_name} = ${yield_text};`);
    deps.push(...collect_deps(yield_text));
    replacements.push({
      start: node.getStart(),
      end: node.end,
      text: temp_name,
    });
  });

  if (replacements.length === 0) {
    return {
      temps,
      rewritten_expr: slice(content, expr).trim(),
      effect_blocks: [],
    };
  }

  replacements.sort((a, b) => b.start - a.start);

  let text = slice(content, expr);

  const offset_in_expr = expr.getFullStart();

  for (const replacement of replacements) {
    text = text.slice(0, replacement.start - offset_in_expr) +
      replacement.text +
      text.slice(replacement.end - offset_in_expr);
  }

  return {
    temps,
    rewritten_expr: text.trim(),
    effect_blocks: [make_effect_block(statements, deps)],
  };
}

function rewrite_state_rune_as_derived(expression: string): string {
  const state_call = expression.match(/^\$state(?:\.raw)?\(([\s\S]*)\)$/);

  if (!state_call) {
    return expression;
  }

  return `$derived(${state_call[1]})`;
}

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

function make_effect_block(
  statements: string[],
  deps: string[],
): EffectBlock {
  return {
    statements,
    deps: [...new Set(deps)],
  };
}

function collect_deps(expr_text: string): string[] {
  return collect_free_identifiers(expr_text).filter(
    (identifier) => !identifier.startsWith("__SER__"),
  );
}
