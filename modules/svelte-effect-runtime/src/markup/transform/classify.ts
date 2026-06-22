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
    case "DeclarationTag":
      classify_declaration_tag(node, candidates, matched, classified);
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
  _node: Extract<AST.Fragment["nodes"][number], { type: "DebugTag" }>,
  _candidates: Map<string, MarkupCandidate>,
  _matched: Set<string>,
  _classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  return;
}

function classify_declaration_tag(
  node: Extract<
    AST.Fragment["nodes"][number],
    { type: "ConstTag" | "DeclarationTag" }
  >,
  candidates: Map<string, MarkupCandidate>,
  matched: Set<string>,
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  for (const decl of node.declaration.declarations) {
    if (!decl.init) {
      continue;
    }

    classify_expression(decl.init, "plain", candidates, matched, classified);
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
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): void {
  for (const attr of node.attributes) {
    if (
      attr.type === "Attribute" &&
      attr.name &&
      is_event_attribute_name(attr.name)
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

function is_event_attribute_name(name: string): boolean {
  return name.startsWith("on:") || /^on[a-z]/.test(name);
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

  const found_candidates = find_candidates(expression, candidates);

  for (const candidate of found_candidates) {
    if (matched.has(candidate.placeholder)) {
      continue;
    }

    matched.add(candidate.placeholder);
    classified.push({
      candidate,
      kind: resolve_candidate_kind(candidate, kind),
    });
  }
}

function resolve_candidate_kind(
  candidate: MarkupCandidate,
  context_kind: TagKind,
): TagKind {
  if (candidate.key === "render_argument") {
    return "render_argument";
  }

  return context_kind;
}

function find_candidates(
  expression: ExpressionLike,
  candidates: Map<string, MarkupCandidate>,
): MarkupCandidate[] {
  const found: MarkupCandidate[] = [];
  const seen_nodes = new Set<unknown>();
  const seen_placeholders = new Set<string>();

  visit_expression_value(
    expression,
    candidates,
    seen_nodes,
    seen_placeholders,
    found,
  );

  return found;
}

function visit_expression_value(
  value: unknown,
  candidates: Map<string, MarkupCandidate>,
  seen_nodes: Set<unknown>,
  seen_placeholders: Set<string>,
  found: MarkupCandidate[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visit_expression_value(
        item,
        candidates,
        seen_nodes,
        seen_placeholders,
        found,
      );
    }

    return;
  }

  if (!is_record(value) || seen_nodes.has(value)) {
    return;
  }

  seen_nodes.add(value);

  if (value.type === "Identifier" && typeof value.name === "string") {
    const candidate = candidates.get(value.name);

    if (candidate && !seen_placeholders.has(candidate.placeholder)) {
      seen_placeholders.add(candidate.placeholder);
      found.push(candidate);
    }
  }

  for (const child of Object.values(value)) {
    visit_expression_value(
      child,
      candidates,
      seen_nodes,
      seen_placeholders,
      found,
    );
  }
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
