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
  const type_helpers: string[] = [];
  const rewritten_decls: string[] = [];
  const statements: string[] = [];
  const deps: string[] = [];

  const decl_list = stmt.declarationList;
  const kind = (decl_list.flags & ts.NodeFlags.Let) !== 0 ? "let" : "const";
  let has_bare_yield = false;
  let uses_dispatcher_promise = false;

  for (const decl of decl_list.declarations) {
    if (!decl.initializer || !contains_top_level_yield_star(decl.initializer)) {
      if (contains_top_level_yield_star(decl.name)) {
        has_bare_yield = true;

        const binding_text = slice(content, decl.name).trim();
        const initializer_text = decl.initializer
          ? slice(content, decl.initializer).trim()
          : "undefined";
        const names = extract_binding_names(decl.name);
        const statement = `(${binding_text} = ${initializer_text});`;

        temps.push(...names.map((name) => make_unknown_temp(name, context)));
        statements.push(statement);
        deps.push(...collect_deps(statement, names));

        continue;
      }

      rewritten_decls.push(slice(content, decl).trim());
      continue;
    }

    const binding_text = slice(content, decl.name).trim();

    if (ts.isIdentifier(decl.name)) {
      const original_name = binding_text;

      if (is_yield_star_expression(decl.initializer)) {
        if (kind === "const") {
          const awaited = make_awaited_yield_initializer(
            decl.initializer,
            content,
            original_name,
            context,
          );

          type_helpers.push(awaited.declaration);
          rewritten_decls.push(`${original_name} = ${awaited.expression}`);
          uses_dispatcher_promise = true;
          continue;
        }

        const temp_name = context.next_temp_name(original_name);
        const yield_text = extract_yield_star_full_text(
          decl.initializer,
          content,
        );
        const type_helper = make_yield_type_helper(
          yield_text,
          original_name,
          context,
        );

        if (type_helper) {
          type_helpers.push(type_helper.declaration);
          temps.push({ name: temp_name, type: type_helper.type });
        } else {
          temps.push({ name: temp_name });
        }

        has_bare_yield = true;
        rewritten_decls.push(`${original_name} = $derived(${temp_name})`);

        statements.push(`${temp_name} = ${yield_text};`);
        deps.push(...collect_deps(yield_text));
      } else {
        const state_rune = get_state_rune_initializer(
          decl.initializer,
          content,
        );

        if (state_rune) {
          const direct_yield_text = extract_yield_star_full_text(
            decl.initializer,
            content,
          );
          const state_type = direct_yield_text === state_rune.value_text
            ? make_yield_type_helper(
              state_rune.value_text,
              original_name,
              context,
            )
            : undefined;

          if (state_type) {
            type_helpers.push(state_type.declaration);
          }

          has_bare_yield = true;
          rewritten_decls.push(
            `${original_name} = ${
              make_state_placeholder(
                state_rune.rune_name,
                state_type?.type,
                context,
              )
            }`,
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
        type_helpers.push(...(lowered.type_helpers ?? []));
        for (const block of lowered.effect_blocks) {
          statements.push(...block.statements);
          deps.push(...block.deps);
        }

        const rewritten_expr = rewrite_state_rune_as_derived(
          lowered.rewritten_expr,
        );
        const final_expr = should_wrap_complex_initializer_as_derived(
            decl.initializer,
            content,
          )
          ? `$derived(${rewritten_expr})`
          : rewritten_expr;

        if (final_expr !== rewritten_expr) {
          has_bare_yield = true;
        }

        rewritten_decls.push(`${original_name} = ${final_expr}`);
      }
    } else {
      has_bare_yield = true;

      const temp_name = context.next_temp_name("destructure");
      const names = extract_binding_names(decl.name);
      const yield_text = extract_yield_star_full_text(
        decl.initializer,
        content,
      );
      const type_helper = make_yield_type_helper(
        yield_text,
        "destructure",
        context,
      );

      if (type_helper) {
        type_helpers.push(type_helper.declaration);
        temps.push({ name: temp_name, type: type_helper.type });
      } else {
        temps.push({ name: temp_name });
      }

      temps.push(...names.map((name) => make_unknown_temp(name, context)));

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
    type_helpers,
    rewritten_text,
    effect_blocks: statements.length === 0
      ? []
      : [make_effect_block(statements, deps)],
    uses_dispatcher_promise,
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

  if (ts.isBinaryExpression(expr) && is_assignment_operator(expr)) {
    const target = slice(content, expr.left).trim();
    const target_names = collect_assignment_target_names(expr.left);

    if (
      expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      is_yield_star_expression(expr.right)
    ) {
      const yield_text = extract_yield_star_full_text(expr.right, content);

      return {
        temps: [],
        rewritten_text: "",
        effect_blocks: [
          make_effect_block(
            [`${target} = ${yield_text};`],
            collect_deps(yield_text, target_names),
          ),
        ],
        range: { start: stmt.getStart(), end: stmt.end },
      };
    }

    const lowered = lower_expression_yields(
      expr.right,
      content,
      make_temp_hint(target),
      context,
    );
    const temp_names = lowered.temps.map((temp) => temp.name);
    const statement = `${target} ${
      slice(content, expr.operatorToken).trim()
    } ${lowered.rewritten_expr};`;

    return {
      temps: lowered.temps,
      type_helpers: lowered.type_helpers,
      rewritten_text: "",
      effect_blocks: [
        make_effect_block(
          [
            ...lowered.effect_blocks.flatMap((block) => block.statements),
            statement,
          ],
          [
            ...lowered.effect_blocks.flatMap((block) => block.deps),
            ...collect_deps(lowered.rewritten_expr, [
              ...target_names,
              ...temp_names,
            ]),
          ],
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

  if (is_top_level_rune_call(expr)) {
    return {
      temps: lowered.temps,
      type_helpers: lowered.type_helpers,
      rewritten_text: lowered.rewritten_expr + ";",
      effect_blocks: lowered.effect_blocks,
      range: { start: stmt.getStart(), end: stmt.end },
    };
  }

  const temp_names = lowered.temps.map((temp) => temp.name);

  return {
    temps: lowered.temps,
    type_helpers: lowered.type_helpers,
    rewritten_text: "",
    effect_blocks: [
      make_effect_block(
        [
          ...lowered.effect_blocks.flatMap((block) => block.statements),
          lowered.rewritten_expr + ";",
        ],
        [
          ...lowered.effect_blocks.flatMap((block) => block.deps),
          ...collect_deps(lowered.rewritten_expr, temp_names),
        ],
      ),
    ],
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
  const type_helpers: string[] = [];
  const statements: string[] = [];
  const deps: string[] = [];

  collect_yield_star_nodes(expr, (node) => {
    const temp_name = context.next_temp_name(hint);
    const yield_text = slice_start(content, node).trim();
    const type_helper = make_yield_type_helper(yield_text, hint, context);

    if (type_helper) {
      type_helpers.push(type_helper.declaration);
      temps.push({ name: temp_name, type: type_helper.type });
    } else {
      temps.push({ name: temp_name });
    }

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
      type_helpers,
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
    type_helpers,
    rewritten_expr: text.trim(),
    effect_blocks: [make_effect_block(statements, deps)],
  };
}

function make_awaited_yield_initializer(
  expr: ts.Expression,
  content: string,
  hint: string,
  context: ScriptLoweringContext,
): { declaration: string; expression: string } {
  const yield_text = extract_yield_star_full_text(expr, content);
  const helper_name = context.next_helper_name(`effect_${hint}`);
  const helper_id = make_script_effect_id(expr, context);
  const deps = collect_deps(yield_text);
  const deps_text = `[${deps.join(", ")}]`;

  return {
    declaration: `function* ${helper_name}() { return (${yield_text}); }`,
    expression: [
      `await ${context.dispatcher_name}().promise({`,
      `id: ${JSON.stringify(helper_id)}, `,
      `deps: ${deps_text}, `,
      `factory: () => ${helper_name}()`,
      `})`,
    ].join(""),
  };
}

function make_yield_type_helper(
  yield_text: string,
  hint: string,
  context: ScriptLoweringContext,
): { declaration: string; type: string } | undefined {
  if (!context.emit_types) {
    return undefined;
  }

  const helper_name = context.next_type_helper_name(hint);
  const effect_text = strip_yield_star(yield_text);

  return {
    declaration: `function ${helper_name}() { return (${effect_text}); }`,
    type:
      `${context.effect_name}.Success<ReturnType<typeof ${helper_name}>> | undefined`,
  };
}

function make_unknown_temp(
  name: string,
  context: ScriptLoweringContext,
): TempBinding {
  return {
    name,
    type: context.emit_types ? "unknown" : undefined,
  };
}

function make_state_placeholder(
  rune_name: string,
  type: string | undefined,
  context: ScriptLoweringContext,
): string {
  if (type) {
    return `${rune_name}<${type}>(undefined)`;
  }

  if (context.emit_types) {
    return `${rune_name}<unknown>(undefined)`;
  }

  return `${rune_name}(undefined)`;
}

function strip_yield_star(yield_text: string): string {
  return yield_text.replace(/^yield\*\s*/, "");
}

function make_script_effect_id(
  expr: ts.Expression,
  context: ScriptLoweringContext,
): string {
  return `${context.filename}:${expr.getStart()}:${expr.end}`;
}

function rewrite_state_rune_as_derived(expression: string): string {
  const state_call = expression.match(/^\$state(?:\.raw)?\(([\s\S]*)\)$/);

  if (!state_call) {
    return expression;
  }

  return `$derived(${state_call[1]})`;
}

function should_wrap_complex_initializer_as_derived(
  expr: ts.Expression,
  content: string,
): boolean {
  const text = slice(content, expr).trim();

  return !/^\$derived(?:\.by)?\(/.test(text) &&
    !/^\$inspect(?:\.trace)?\(/.test(text);
}

function is_assignment_operator(expr: ts.BinaryExpression): boolean {
  return expr.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    expr.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

function is_top_level_rune_call(expr: ts.Expression): boolean {
  if (!ts.isCallExpression(expr)) {
    return false;
  }

  const callee = expr.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text.startsWith("$");
  }

  return ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text.startsWith("$");
}

function make_temp_hint(target: string): string {
  const match = target.match(/[A-Za-z_$][\w$]*$/);

  return match?.[0] ?? "assignment";
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

function collect_deps(
  expr_text: string,
  excluded_names: readonly string[] = [],
): string[] {
  const excluded = new Set(excluded_names);

  return collect_free_identifiers(expr_text).filter(
    (identifier) =>
      !identifier.startsWith("__SER___") && !excluded.has(identifier),
  );
}

function collect_assignment_target_names(node: ts.Node): string[] {
  if (ts.isIdentifier(node)) {
    return [node.text];
  }

  if (ts.isParenthesizedExpression(node)) {
    return collect_assignment_target_names(node.expression);
  }

  if (
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
  ) {
    return collect_assignment_target_names(node.expression);
  }

  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) {
        return [property.name.text];
      }

      if (ts.isPropertyAssignment(property)) {
        return collect_assignment_target_names(property.initializer);
      }

      if (ts.isSpreadAssignment(property)) {
        return collect_assignment_target_names(property.expression);
      }

      return [];
    });
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) =>
      ts.isSpreadElement(element)
        ? collect_assignment_target_names(element.expression)
        : collect_assignment_target_names(element)
    );
  }

  return [];
}
