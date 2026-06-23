import { contains_top_level_yield_star } from "$/detect.ts";
import { AsyncEffectInSyncRuneError } from "$/error.ts";
import { slice } from "./source.ts";

import ts from "typescript";

const ASYNC_EXPRESSION_RUNES = new Set([
  "$derived",
  "$inspect",
  "$state",
  "$state.raw",
]);

const CALLBACK_RUNES = new Set([
  "$derived.by",
  "$effect",
  "$effect.pre",
  "$effect.root",
]);

/**
 * Validates that `yield*` only appears in rune positions the script-effect
 * transform can lower without changing the rune's normal Svelte contract.
 *
 * @since 2.0.0
 * @param node - AST node to scan.
 * @param content - Original script source used for diagnostics.
 * @param filename - Source filename used for diagnostics.
 * @returns Nothing.
 */
export function validate_rune_yield_usage(
  node: ts.Node,
  content: string,
  filename: string,
): void {
  visit_rune_yield_usage(node, content, filename);
}

/**
 * Identifies `$state(...)` and `$state.raw(...)` initializer calls.
 *
 * @since 2.0.0
 * @param expr - Expression to classify.
 * @param content - Original script source used to preserve argument text.
 * @returns State rune details when the expression is a state initializer.
 */
export function get_state_rune_initializer(
  expr: ts.Expression,
  content: string,
): { rune_name: "$state" | "$state.raw"; value_text: string } | undefined {
  if (!ts.isCallExpression(expr)) {
    return undefined;
  }

  const rune_name = get_rune_name(expr.expression);

  if (rune_name !== "$state" && rune_name !== "$state.raw") {
    return undefined;
  }

  const first_arg = expr.arguments[0];

  if (!first_arg) {
    return undefined;
  }

  return {
    rune_name,
    value_text: slice(content, first_arg).trim(),
  };
}

function visit_rune_yield_usage(
  node: ts.Node,
  content: string,
  filename: string,
): void {
  if (ts.isCallExpression(node)) {
    validate_call_expression(node, content, filename);
  }

  node.forEachChild((child) => {
    visit_rune_yield_usage(child, content, filename);
  });
}

function validate_call_expression(
  call: ts.CallExpression,
  content: string,
  filename: string,
): void {
  const rune_name = get_rune_name(call.expression);

  if (!rune_name) {
    return;
  }

  if (
    !ASYNC_EXPRESSION_RUNES.has(rune_name) &&
    contains_top_level_yield_star(call)
  ) {
    throw new AsyncEffectInSyncRuneError(
      rune_name,
      slice(content, call),
      filename,
    );
  }

  if (!CALLBACK_RUNES.has(rune_name)) {
    return;
  }

  const callback = call.arguments[0];

  if (!callback || !callback_has_top_level_yield_star(callback)) {
    return;
  }

  throw new AsyncEffectInSyncRuneError(
    rune_name,
    slice(content, call),
    filename,
  );
}

function callback_has_top_level_yield_star(node: ts.Expression): boolean {
  if (
    (ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)) &&
    node.body !== undefined
  ) {
    return contains_top_level_yield_star(node.body);
  }

  return contains_top_level_yield_star(node);
}

function get_rune_name(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr) && is_rune_root(expr.text)) {
    return expr.text;
  }

  if (!ts.isPropertyAccessExpression(expr)) {
    return undefined;
  }

  const root_name = get_rune_name(expr.expression);

  if (!root_name) {
    return undefined;
  }

  return `${root_name}.${expr.name.text}`;
}

function is_rune_root(name: string): boolean {
  return (
    name === "$bindable" ||
    name === "$derived" ||
    name === "$effect" ||
    name === "$host" ||
    name === "$inspect" ||
    name === "$props" ||
    name === "$state"
  );
}
