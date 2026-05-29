import type { AST } from "svelte/compiler";

import type { MarkupCandidate, TagKind } from "./types.ts";

/**
 * Matches sanitized placeholders back to their Svelte AST context.
 *
 * @since 2.0.0
 * @param ast - Parsed Svelte AST for the sanitized component markup.
 * @param candidates - Placeholder candidates produced by the scanner.
 * @returns Candidates paired with the markup context that determines how they
 *   should be emitted.
 */
export function classify_candidates(
  ast: AST.Root,
  candidates: MarkupCandidate[],
): Array<{ candidate: MarkupCandidate; kind: TagKind }> {
  const by_placeholder = new Map(
    candidates.map((candidate) => [candidate.placeholder, candidate]),
  );

  const classified: Array<{ candidate: MarkupCandidate; kind: TagKind }> = [];
  const matched = new Set<string>();

  walk_ast(ast.fragment, by_placeholder, matched, classified);

  return classified;
}

function walk_ast(
  fragment: AST.Fragment,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  for (const node of fragment.nodes) {
    visit_ast_node(node, candidates, matched, classified);
  }
}

function visit_ast_node(
  node: AST.Fragment["nodes"][number],
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  switch (node.type) {
    case "ExpressionTag":
      classify_expression(
        node.expression,
        "plain",
        candidates,
        matched,
        classified,
      );
      return;

    case "IfBlock":
      classify_expression(node.test, "plain", candidates, matched, classified);
      walk_ast(node.consequent, candidates, matched, classified);
      if (node.alternate) {
        walk_ast(node.alternate, candidates, matched, classified);
      }
      return;

    case "EachBlock":
      classify_expression(
        node.expression,
        "each",
        candidates,
        matched,
        classified,
      );
      walk_ast(node.body, candidates, matched, classified);
      if (node.fallback) {
        walk_ast(node.fallback, candidates, matched, classified);
      }
      return;

    case "AwaitBlock":
      classify_expression(
        node.expression,
        "await",
        candidates,
        matched,
        classified,
      );
      if (node.pending) {
        walk_ast(node.pending, candidates, matched, classified);
      }
      if (node.then) walk_ast(node.then, candidates, matched, classified);
      if (node.catch) walk_ast(node.catch, candidates, matched, classified);
      return;

    case "RenderTag":
      classify_expression(
        node.expression,
        "render",
        candidates,
        matched,
        classified,
      );
      return;

    case "HtmlTag":
      classify_expression(
        node.expression,
        "plain",
        candidates,
        matched,
        classified,
      );
      return;

    case "DebugTag":
      classify_debug_tag(node, candidates, matched, classified);
      return;

    case "ConstTag":
      classify_const_tag(node, candidates, matched, classified);
      return;

    case "KeyBlock":
      classify_expression(
        node.expression,
        "plain",
        candidates,
        matched,
        classified,
      );
      walk_ast(node.fragment, candidates, matched, classified);
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
      visit_element_attributes(node, candidates, matched, classified);
      walk_ast(node.fragment, candidates, matched, classified);
      return;

    default:
      return;
  }
}

function classify_debug_tag(
  node: Extract<AST.Fragment["nodes"][number], { type: "DebugTag" }>,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  const idents = node.identifiers;

  if (!idents || idents.length === 0) {
    return;
  }

  for (const ident of idents) {
    classify_expression(ident, "plain", candidates, matched, classified);
  }
}

function classify_const_tag(
  node: Extract<AST.Fragment["nodes"][number], { type: "ConstTag" }>,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  const decl = node.declaration.declarations[0];

  if (!decl?.init) {
    return;
  }

  classify_expression(decl.init, "plain", candidates, matched, classified);
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
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  for (const attr of node.attributes) {
    if (
      attr.type === "Attribute" &&
      attr.name &&
      (attr.name.startsWith("on:") || /^on[a-z]/.test(attr.name))
    ) {
      visit_attribute_value(
        attr.value as
          | true
          | AST.ExpressionTag
          | Array<AST.Text | AST.ExpressionTag>,
        "event",
        candidates,
        matched,
        classified,
      );
      continue;
    }

    if (attr.type === "OnDirective" && attr.expression) {
      classify_expression(
        attr.expression as ExpressionLike,
        "event",
        candidates,
        matched,
        classified,
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
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  if (value === true) {
    return;
  }

  if (Array.isArray(value)) {
    for (const part of value) {
      if (part.type === "ExpressionTag") {
        classify_expression(
          part.expression,
          kind,
          candidates,
          matched,
          classified,
        );
      }
    }
    return;
  }

  classify_expression(
    value.expression,
    kind,
    candidates,
    matched,
    classified,
  );
}

type ExpressionLike = {
  type: string;
  name?: string;
  callee?: { type: string; name?: string };
};

function classify_expression(
  expression: ExpressionLike | null | undefined,
  kind: TagKind,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  if (!expression) {
    return;
  }

  const candidate = find_candidate(expression, candidates);

  if (!candidate || matched.has(candidate.placeholder)) {
    return;
  }

  matched.add(candidate.placeholder);
  classified.push({ candidate, kind });
}

function find_candidate(
  expression: ExpressionLike,
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
