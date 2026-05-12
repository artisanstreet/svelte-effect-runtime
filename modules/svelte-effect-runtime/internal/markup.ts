import MagicString, { type SourceMap } from "magic-string";
import { parseExpression as parseBabelExpression } from "@babel/parser";
import { type AST, parse } from "svelte/compiler";
import ts from "typescript";
import type { EffectPreprocessOptions } from "$/preprocess.ts";

const DEFAULT_RUNTIME_MODULE_ID = "svelte-effect-runtime";
const DEFAULT_EFFECT_MODULE_ID = "effect";
const DEFAULT_SVELTE_MODULE_ID = "svelte";
const MARKUP_HELPER_PREFIX = "__svelteEffectRuntimeMarkup";

interface TransformEffectMarkupOptions extends EffectPreprocessOptions {
  filename: string;
}

interface TransformEffectMarkupResult {
  code: string;
  map: SourceMap;
}

interface ExcludedRange {
  start: number;
  end: number;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

interface MarkupCandidate {
  expressionText: string;
  placeholder: string;
  placeholderExpression: string;
  start: number;
  end: number;
}

interface WrappedExpression {
  expression: ts.Expression;
  offset: number;
  sourceFile: ts.SourceFile;
}

type BraceTagKind =
  | "attach"
  | "await"
  | "closing"
  | "const"
  | "debug"
  | "each"
  | "else-if"
  | "html"
  | "if"
  | "key"
  | "plain"
  | "render"
  | "spread";

export function transformEffectMarkup(
  content: string,
  options: TransformEffectMarkupOptions,
): TransformEffectMarkupResult {
  const sanitized = sanitizeEffectMarkup(
    content,
    options.filename,
  );

  if (sanitized.candidates.length === 0) {
    const identity = new MagicString(content);
    return {
      code: content,
      map: identity.generateMap({
        hires: true,
        includeContent: true,
        source: options.filename,
      }),
    };
  }

  const replacements = collectMarkupReplacements(
    createParseSafeMarkupSource(sanitized.code),
    sanitized.candidates,
    options.filename,
  );

  const magicString = new MagicString(content);

  for (const replacement of replacements) {
    magicString.overwrite(replacement.start, replacement.end, replacement.text);
  }

  injectMarkupHelpers(magicString, content, options);

  return {
    code: magicString.toString(),
    map: magicString.generateMap({
      hires: true,
      includeContent: true,
      source: options.filename,
    }),
  };
}

function createParseSafeMarkupSource(content: string): string {
  const excludedRanges = findParseSafeMaskRanges(content);

  if (excludedRanges.length === 0) {
    return content;
  }

  let result = "";
  let cursor = 0;

  for (const range of excludedRanges) {
    result += content.slice(cursor, range.start);
    result += maskExcludedText(content.slice(range.start, range.end));
    cursor = range.end;
  }

  result += content.slice(cursor);
  return result;
}

function maskExcludedText(text: string): string {
  let result = "";

  for (const character of text) {
    result += character === "\n" || character === "\r" ? character : " ";
  }

  return result;
}

function sanitizeEffectMarkup(
  content: string,
  filename: string,
): { code: string; candidates: MarkupCandidate[] } {
  const excludedRanges = findExcludedRanges(content);
  const candidates: MarkupCandidate[] = [];
  const magicString = new MagicString(content);
  let helperIndex = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "{") {
      continue;
    }

    const range = findExcludedRangeAt(excludedRanges, index);

    if (range) {
      index = range.end - 1;
      continue;
    }

    const closingIndex = findMarkupBraceClose(
      content,
      index,
      filename,
    );

    if (closingIndex === -1) {
      continue;
    }

    const inner = content.slice(index + 1, closingIndex);
    const candidate = getCandidateForBraceTag(
      index,
      closingIndex,
      inner,
      filename,
      helperIndex,
    );

    if (candidate) {
      helperIndex += 1;
      candidates.push(candidate);
      magicString.overwrite(
        candidate.start,
        candidate.end,
        candidate.placeholderExpression,
      );
    }

    index = closingIndex;
  }

  return {
    code: magicString.toString(),
    candidates,
  };
}

function collectMarkupReplacements(
  sanitizedContent: string,
  candidates: readonly MarkupCandidate[],
  filename: string,
): Replacement[] {
  const ast = parse(sanitizedContent, {
    filename,
    modern: true,
  });
  const candidatesByPlaceholder = new Map(
    candidates.map((candidate) => [candidate.placeholder, candidate]),
  );
  const replacements: Replacement[] = [];
  const matchedPlaceholders = new Set<string>();

  visitFragment(ast.fragment, candidatesByPlaceholder, matchedPlaceholders, (
    candidate,
    kind,
  ) => {
    replacements.push(makeAstReplacement(candidate, kind, filename));
  });

  const unmatched = candidates.filter((candidate) =>
    !matchedPlaceholders.has(candidate.placeholder)
  );

  if (unmatched.length > 0) {
    throw new Error(
      `${filename}: failed to classify some markup Effect expressions.\n` +
        unmatched.map((candidate) =>
          `Problematic expression:\n${candidate.expressionText}`
        ).join("\n\n"),
    );
  }

  return replacements.sort((left, right) => left.start - right.start);
}

function getCandidateForBraceTag(
  openBraceIndex: number,
  closeBraceIndex: number,
  inner: string,
  filename: string,
  helperIndex: number,
): MarkupCandidate | undefined {
  const trimmed = inner.trimStart();
  const leadingWhitespaceLength = inner.length - trimmed.length;
  const tag = getBraceTagInfo(trimmed);

  if (trimmed.includes(MARKUP_HELPER_PREFIX)) {
    return undefined;
  }

  // Strip the tag prefix (e.g. `...`, `@render`, `#each`) before checking
  // for top-level `yield*` — the inner expression is what the transform
  // ultimately wraps, and tag tokens aren't valid standalone JS.
  if (!containsYieldStarText(trimmed.slice(tag.prefixLength))) {
    return undefined;
  }

  if (tag.kind === "const") {
    const initializerRange = findConstInitializerRange(
      trimmed.slice(tag.prefixLength),
      filename,
    );

    return initializerRange
      ? makeMarkupCandidate(
        openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength +
          initializerRange.start,
        openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength +
          initializerRange.end,
        trimmed.slice(
          tag.prefixLength + initializerRange.start,
          tag.prefixLength + initializerRange.end,
        ),
        helperIndex,
      )
      : undefined;
  }

  if (tag.kind === "if" || tag.kind === "else-if") {
    return makeMarkupCandidate(
      openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength,
      closeBraceIndex,
      trimmed.slice(tag.prefixLength),
      helperIndex,
    );
  }

  if (tag.kind === "each") {
    const eachHeader = trimmed.slice(tag.prefixLength);
    const asIndex = findTopLevelKeyword(eachHeader, " as ");

    if (asIndex === -1) {
      return undefined;
    }

    const listExpression = eachHeader.slice(0, asIndex);

    return makeMarkupCandidate(
      openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength,
      openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength +
        listExpression.length,
      listExpression,
      helperIndex,
    );
  }

  if (tag.kind === "await") {
    const awaitHeader = trimmed.slice(tag.prefixLength);
    const boundary = findAwaitBoundary(awaitHeader);
    const expressionText = boundary === -1
      ? awaitHeader
      : awaitHeader.slice(0, boundary);

    return makeMarkupCandidate(
      openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength,
      openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength +
        expressionText.length,
      expressionText,
      helperIndex,
    );
  }

  if (tag.kind === "render") {
    const renderExpression = trimmed.slice(tag.prefixLength);
    assertRenderableMarkupExpression(
      renderExpression,
      filename,
      inner,
    );

    return makeMarkupCandidate(
      openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength,
      closeBraceIndex,
      renderExpression,
      helperIndex,
      "call",
    );
  }

  if (
    tag.kind === "attach" || tag.kind === "html" || tag.kind === "key" ||
    tag.kind === "spread"
  ) {
    return makeMarkupCandidate(
      openBraceIndex + 1 + leadingWhitespaceLength + tag.prefixLength,
      closeBraceIndex,
      trimmed.slice(tag.prefixLength),
      helperIndex,
    );
  }

  if (tag.kind === "debug") {
    throw new Error(
      `${filename}: {@debug ...} cannot depend on yield* in markup right now.\nMove the Effect code into <script effect> or a helper binding instead.\n\nProblematic tag:\n{${inner}}`,
    );
  }

  if (tag.kind === "closing") {
    return undefined;
  }

  return makeMarkupCandidate(
    openBraceIndex + 1,
    closeBraceIndex,
    inner,
    helperIndex,
  );
}

function makeMarkupCandidate(
  start: number,
  end: number,
  expressionText: string,
  helperIndex: number,
  placeholderShape: "identifier" | "call" = "identifier",
): MarkupCandidate {
  const placeholder = `${MARKUP_HELPER_PREFIX}Placeholder${helperIndex}`;

  return {
    expressionText,
    placeholder,
    placeholderExpression: placeholderShape === "call"
      ? `${placeholder}()`
      : placeholder,
    start,
    end,
  };
}

function makeAstReplacement(
  candidate: MarkupCandidate,
  kind: "plain" | "each" | "await" | "event" | "render",
  filename: string,
): Replacement {
  if (kind === "event") {
    return {
      start: candidate.start,
      end: candidate.end,
      text: transformEventExpression(candidate.expressionText.trim(), filename),
    };
  }

  const helperId = `${MARKUP_HELPER_PREFIX}${candidate.placeholder}`;
  const deps = collectFreeIdentifiers(candidate.expressionText, filename);
  const depsText = deps.length === 0 ? "[]" : `[${deps.join(", ")}]`;
  const trimmedExpression = candidate.expressionText.trim();

  let replacementText: string;

  if (kind === "await") {
    replacementText =
      `${MARKUP_HELPER_PREFIX}Promise("${helperId}", ${depsText}, function* () { return (${trimmedExpression}); })`;
  } else if (kind === "render") {
    // Svelte 5 compiles `{@render X(args)}` as a snippet call that prepends
    // the anchor node and thunks each argument. Wrapping in `(... )()` makes
    // Svelte emit `$.snippet(node, () => Value(...))` instead, so our helper
    // receives its real arguments (id, deps, factory, fallback) and the
    // returned snippet is invoked with the anchor by Svelte's snippet runtime.
    // Use a no-op snippet as the fallback so SSR and the initial client render
    // both have a callable snippet even before the Effect has resolved.
    replacementText =
      `(${MARKUP_HELPER_PREFIX}Value("${helperId}", ${depsText}, function* () { return (${trimmedExpression}); }, function () {}))()`;
  } else {
    replacementText =
      `${MARKUP_HELPER_PREFIX}Value("${helperId}", ${depsText}, function* () { return (${trimmedExpression}); }, ${
        kind === "each" ? "[]" : "undefined"
      })`;
  }

  return {
    start: candidate.start,
    end: candidate.end,
    text: replacementText,
  };
}

function visitFragment(
  fragment: AST.Fragment,
  candidatesByPlaceholder: ReadonlyMap<string, MarkupCandidate>,
  matchedPlaceholders: Set<string>,
  onReplacement: (
    candidate: MarkupCandidate,
    kind: "plain" | "each" | "await" | "event" | "render",
  ) => void,
): void {
  for (const node of fragment.nodes) {
    visitNode(
      node,
      candidatesByPlaceholder,
      matchedPlaceholders,
      onReplacement,
    );
  }
}

function visitNode(
  node: AST.Fragment["nodes"][number],
  candidatesByPlaceholder: ReadonlyMap<string, MarkupCandidate>,
  matchedPlaceholders: Set<string>,
  onReplacement: (
    candidate: MarkupCandidate,
    kind: "plain" | "each" | "await" | "event" | "render",
  ) => void,
): void {
  switch (node.type) {
    case "ExpressionTag":
    case "HtmlTag":
    case "AttachTag":
      emitReplacementForExpression(
        node.expression,
        "plain",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    case "RenderTag":
      emitReplacementForExpression(
        node.expression,
        "render",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    case "ConstTag":
      emitReplacementForExpression(
        node.declaration.declarations[0]?.init,
        "plain",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    case "IfBlock":
      emitReplacementForExpression(
        node.test,
        "plain",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      visitFragment(
        node.consequent,
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      if (node.alternate) {
        visitFragment(
          node.alternate,
          candidatesByPlaceholder,
          matchedPlaceholders,
          onReplacement,
        );
      }
      return;

    case "EachBlock":
      emitReplacementForExpression(
        node.expression,
        "each",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      visitFragment(
        node.body,
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      if (node.fallback) {
        visitFragment(
          node.fallback,
          candidatesByPlaceholder,
          matchedPlaceholders,
          onReplacement,
        );
      }
      return;

    case "AwaitBlock":
      emitReplacementForExpression(
        node.expression,
        "await",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      if (node.pending) {
        visitFragment(
          node.pending,
          candidatesByPlaceholder,
          matchedPlaceholders,
          onReplacement,
        );
      }
      if (node.then) {
        visitFragment(
          node.then,
          candidatesByPlaceholder,
          matchedPlaceholders,
          onReplacement,
        );
      }
      if (node.catch) {
        visitFragment(
          node.catch,
          candidatesByPlaceholder,
          matchedPlaceholders,
          onReplacement,
        );
      }
      return;

    case "KeyBlock":
      emitReplacementForExpression(
        node.expression,
        "plain",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      visitFragment(
        node.fragment,
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
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
      for (const attribute of node.attributes) {
        visitAttribute(
          attribute,
          candidatesByPlaceholder,
          matchedPlaceholders,
          onReplacement,
        );
      }
      visitFragment(
        node.fragment,
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    default:
      return;
  }
}

function visitAttribute(
  attribute: AST.BaseElement["attributes"][number],
  candidatesByPlaceholder: ReadonlyMap<string, MarkupCandidate>,
  matchedPlaceholders: Set<string>,
  onReplacement: (
    candidate: MarkupCandidate,
    kind: "plain" | "each" | "await" | "event" | "render",
  ) => void,
): void {
  switch (attribute.type) {
    case "Attribute": {
      const kind = isEventAttribute(attribute.name) ? "event" : "plain";
      visitAttributeValue(
        attribute.value,
        kind,
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;
    }

    case "OnDirective":
      emitReplacementForExpression(
        attribute.expression,
        "event",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    case "AttachTag":
      emitReplacementForExpression(
        attribute.expression,
        "plain",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    case "SpreadAttribute":
    case "AnimateDirective":
    case "BindDirective":
    case "ClassDirective":
    case "TransitionDirective":
    case "UseDirective":
      emitReplacementForExpression(
        attribute.expression,
        "plain",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    case "StyleDirective":
      visitAttributeValue(
        attribute.value,
        "plain",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    case "LetDirective":
      emitReplacementForExpression(
        attribute.expression,
        "plain",
        candidatesByPlaceholder,
        matchedPlaceholders,
        onReplacement,
      );
      return;

    default:
      return;
  }
}

function visitAttributeValue(
  value:
    | true
    | AST.ExpressionTag
    | Array<AST.Text | AST.ExpressionTag>,
  kind: "plain" | "each" | "await" | "event" | "render",
  candidatesByPlaceholder: ReadonlyMap<string, MarkupCandidate>,
  matchedPlaceholders: Set<string>,
  onReplacement: (
    candidate: MarkupCandidate,
    kind: "plain" | "each" | "await" | "event" | "render",
  ) => void,
): void {
  if (value === true) {
    return;
  }

  if (Array.isArray(value)) {
    for (const part of value) {
      if (part.type === "ExpressionTag") {
        emitReplacementForExpression(
          part.expression,
          kind,
          candidatesByPlaceholder,
          matchedPlaceholders,
          onReplacement,
        );
      }
    }
    return;
  }

  emitReplacementForExpression(
    value.expression,
    kind,
    candidatesByPlaceholder,
    matchedPlaceholders,
    onReplacement,
  );
}

function emitReplacementForExpression(
  expression: { type: string; name?: string } | null | undefined,
  kind: "plain" | "each" | "await" | "event" | "render",
  candidatesByPlaceholder: ReadonlyMap<string, MarkupCandidate>,
  matchedPlaceholders: Set<string>,
  onReplacement: (
    candidate: MarkupCandidate,
    kind: "plain" | "each" | "await" | "event" | "render",
  ) => void,
): void {
  const candidate = findCandidateForExpression(
    expression,
    candidatesByPlaceholder,
  );

  if (!candidate || matchedPlaceholders.has(candidate.placeholder)) {
    return;
  }

  matchedPlaceholders.add(candidate.placeholder);
  onReplacement(candidate, kind);
}

function findCandidateForExpression(
  expression:
    | { type: string; name?: string; callee?: { type: string; name?: string } }
    | null
    | undefined,
  candidatesByPlaceholder: ReadonlyMap<string, MarkupCandidate>,
): MarkupCandidate | undefined {
  if (!expression) {
    return undefined;
  }

  if (expression.type === "Identifier" && expression.name) {
    return candidatesByPlaceholder.get(expression.name);
  }

  if (
    expression.type === "CallExpression" &&
    expression.callee?.type === "Identifier" &&
    expression.callee.name
  ) {
    return candidatesByPlaceholder.get(expression.callee.name);
  }

  return undefined;
}

function assertRenderableMarkupExpression(
  expressionText: string,
  filename: string,
  originalTagContents: string,
): void {
  const wrapped = parseWrappedExpression(expressionText, filename);
  const expression = unwrapParentheses(wrapped.expression);

  if (isRenderableMarkupExpression(expression)) {
    return;
  }

  throw new Error(
    `${filename}: {@render ...} must still resolve to a call expression when using yield* in markup.\n` +
      `Supported examples: {@render yield* snippet()}, {@render (yield* snippet())}, {@render snippet(yield* arg())}.\n\n` +
      `Problematic tag:\n{${originalTagContents}}`,
  );
}

function isRenderableMarkupExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapParentheses(expression);

  if (ts.isCallExpression(unwrapped)) {
    return true;
  }

  if (ts.isYieldExpression(unwrapped) && unwrapped.asteriskToken) {
    return !!unwrapped.expression &&
      ts.isCallExpression(unwrapParentheses(unwrapped.expression));
  }

  return false;
}

function findConstInitializerRange(
  declarationText: string,
  filename: string,
): { start: number; end: number } | undefined {
  const sourceFile = ts.createSourceFile(
    filename,
    `const ${declarationText};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];

  if (!statement || !ts.isVariableStatement(statement)) {
    return undefined;
  }

  const declaration = statement.declarationList.declarations[0];

  if (!declaration?.initializer) {
    return undefined;
  }

  return {
    start: declaration.initializer.getStart(sourceFile) - "const ".length,
    end: declaration.initializer.end - "const ".length,
  };
}

function transformEventExpression(
  expressionText: string,
  filename: string,
): string {
  const wrapped = parseWrappedExpression(expressionText, filename);
  const expression = unwrapParentheses(wrapped.expression);

  if (ts.isArrowFunction(expression)) {
    const signatureText = sliceWrappedNode(
      expressionText,
      wrapped,
      expression.getStart(wrapped.sourceFile),
      expression.equalsGreaterThanToken.end,
    );

    if (ts.isBlock(expression.body)) {
      return `${signatureText} ${
        makeInlineEventBlock(
          sliceWrappedNode(
            expressionText,
            wrapped,
            expression.body.getStart(wrapped.sourceFile) + 1,
            expression.body.end - 1,
          ),
        )
      }`;
    }

    return `${signatureText} ${
      makeInlineEventExpressionBody(
        sliceWrappedNode(
          expressionText,
          wrapped,
          expression.body.getStart(wrapped.sourceFile),
          expression.body.end,
        ),
      )
    }`;
  }

  if (ts.isFunctionExpression(expression)) {
    const signatureText = sliceWrappedNode(
      expressionText,
      wrapped,
      expression.getStart(wrapped.sourceFile),
      expression.body.getStart(wrapped.sourceFile),
    );
    const bodyText = sliceWrappedNode(
      expressionText,
      wrapped,
      expression.body.getStart(wrapped.sourceFile) + 1,
      expression.body.end - 1,
    );

    return `${signatureText}${makeInlineEventBlock(bodyText)}`;
  }

  return `() => ${makeInlineEventExpressionBody(expressionText)}`;
}

function makeInlineEventBlock(bodyText: string): string {
  const normalizedBody = bodyText.trim();

  if (normalizedBody.length === 0) {
    return `{ void ${MARKUP_HELPER_PREFIX}Run(function* () {}); }`;
  }

  return [
    "{",
    `  void ${MARKUP_HELPER_PREFIX}Run(function* () {`,
    indentBlock(normalizedBody, "    "),
    "  });",
    "}",
  ].join("\n");
}

function makeInlineEventExpressionBody(expressionText: string): string {
  return [
    "{",
    `  void ${MARKUP_HELPER_PREFIX}Run(function* () {`,
    `    return (${expressionText.trim()});`,
    "  });",
    "}",
  ].join("\n");
}

function parseWrappedExpression(
  expressionText: string,
  filename: string,
): WrappedExpression {
  const prefix = "function* __svelteEffectRuntimeMarkupWrapper(){ return (";
  const sourceFile = ts.createSourceFile(
    filename,
    `${prefix}${expressionText}); }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const functionDeclaration = sourceFile.statements[0];

  if (
    !functionDeclaration || !ts.isFunctionDeclaration(functionDeclaration) ||
    !functionDeclaration.body
  ) {
    throw new Error(
      `${filename}: could not parse markup Effect expression:\n${expressionText}`,
    );
  }

  const returnStatement = functionDeclaration.body.statements[0];

  if (
    !returnStatement || !ts.isReturnStatement(returnStatement) ||
    !returnStatement.expression
  ) {
    throw new Error(
      `${filename}: could not locate markup Effect expression:\n${expressionText}`,
    );
  }

  return {
    expression: returnStatement.expression,
    offset: prefix.length,
    sourceFile,
  };
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  return current;
}

function sliceWrappedNode(
  expressionText: string,
  wrapped: WrappedExpression,
  start: number,
  end: number,
): string {
  return expressionText.slice(start - wrapped.offset, end - wrapped.offset);
}

function collectFreeIdentifiers(
  expressionText: string,
  filename: string,
): string[] {
  const wrapped = parseWrappedExpression(expressionText, filename);
  const identifiers: string[] = [];
  const seen = new Set<string>();
  const scopes: Array<Set<string>> = [new Set()];

  function isDeclaredLocally(identifier: string): boolean {
    return scopes.some((scope) => scope.has(identifier));
  }

  function visit(node: ts.Node): void {
    if (
      ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      if (!node.body) {
        return;
      }

      const nextScope = new Set<string>();

      if (node.name) {
        nextScope.add(node.name.text);
      }

      for (const parameter of node.parameters) {
        declareInto(nextScope, parameter.name);
      }

      scopes.unshift(nextScope);

      if (ts.isBlock(node.body)) {
        for (const statement of node.body.statements) {
          statement.forEachChild(visit);
        }
      } else {
        node.body.forEachChild(visit);
      }

      scopes.shift();
      return;
    }

    if (ts.isIdentifier(node)) {
      if (node.text === "yield" || node.text === "undefined") {
        return;
      }

      if (shouldSkipIdentifier(node)) {
        return;
      }

      if (!isDeclaredLocally(node.text) && !seen.has(node.text)) {
        seen.add(node.text);
        identifiers.push(node.text);
      }
    }

    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) {
        node.initializer.forEachChild(visit);
      }
      return;
    }

    node.forEachChild(visit);
  }

  function declareInto(scope: Set<string>, name: ts.BindingName): void {
    if (ts.isIdentifier(name)) {
      scope.add(name.text);
      return;
    }

    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }

      declareInto(scope, element.name);
    }
  }

  visit(unwrapParentheses(wrapped.expression));
  return identifiers;
}

function shouldSkipIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;

  return ts.isPropertyAccessExpression(parent) && parent.name === node ||
    ts.isPropertyAssignment(parent) && parent.name === node ||
    ts.isShorthandPropertyAssignment(parent) &&
      parent.objectAssignmentInitializer === node ||
    ts.isBindingElement(parent) && parent.propertyName === node ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isLabeledStatement(parent) && parent.label === node;
}

function containsYieldStarText(text: string): boolean {
  if (!/\byield\s*\*/.test(text)) {
    return false;
  }

  // The cheap regex picks up `yield*` that lives inside nested generators
  // (e.g. `Effect.gen(function* () { yield* foo(); })` passed as an enhance
  // callback). Those yields belong to the inner generator and must not be
  // lowered by the markup transform. Walk the Babel AST and only count
  // `yield*` that's reachable without crossing a function boundary.
  try {
    return topLevelYieldStarPresent(text);
  } catch {
    // Parser failure — fall back to the conservative regex match so we
    // don't lose lowering for valid yield* usage that happens to confuse
    // the parser in isolation.
    return true;
  }
}

function topLevelYieldStarPresent(text: string): boolean {
  const ast = parseBabelExpression(text, {
    sourceType: "module",
    allowAwaitOutsideFunction: true,
    allowYieldOutsideFunction: true,
  });

  return hasTopLevelYieldStar(ast as unknown as BabelNode);
}

interface BabelNode {
  type: string;
  delegate?: boolean;
  [key: string]: unknown;
}

function hasTopLevelYieldStar(node: BabelNode | null | undefined): boolean {
  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return false;
  }

  if (node.type === "YieldExpression" && node.delegate === true) {
    return true;
  }

  // Function-like scopes own their own `yield*` semantics. The user's
  // `yield*` inside `Effect.gen(function* () { ... })` is a normal
  // generator yield, not a marker for the markup transform.
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ObjectMethod" ||
    node.type === "ClassMethod" ||
    node.type === "ClassPrivateMethod"
  ) {
    return false;
  }

  for (const key of Object.keys(node)) {
    if (key === "type" || key === "loc" || key === "start" || key === "end") {
      continue;
    }

    const value = (node as Record<string, unknown>)[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        if (hasTopLevelYieldStar(item as BabelNode)) {
          return true;
        }
      }
    } else if (value && typeof value === "object") {
      if (hasTopLevelYieldStar(value as BabelNode)) {
        return true;
      }
    }
  }

  return false;
}

function findMarkupBraceClose(
  content: string,
  openBraceIndex: number,
  filename: string,
): number {
  const expressionClose = findExpressionBraceCloseWithBabel(
    content,
    openBraceIndex,
    filename,
  );

  if (expressionClose !== undefined) {
    return expressionClose;
  }

  return findClosingBrace(content, openBraceIndex + 1);
}

function findExpressionBraceCloseWithBabel(
  content: string,
  openBraceIndex: number,
  filename: string,
): number | undefined {
  const tail = content.slice(openBraceIndex + 1);
  const trimmed = tail.trimStart();
  const leadingWhitespaceLength = tail.length - trimmed.length;
  const prefixLength = getBabelExpressionPrefixLength(trimmed);

  if (prefixLength === undefined) {
    return undefined;
  }

  const expressionTail = trimmed.slice(prefixLength);
  const boundary = findBabelExpressionBoundary(expressionTail, filename);
  const closeIndex = openBraceIndex + 1 + leadingWhitespaceLength +
    prefixLength + boundary;

  return content[closeIndex] === "}" ? closeIndex : undefined;
}

function getBabelExpressionPrefixLength(trimmed: string): number | undefined {
  const tag = getBraceTagInfo(trimmed);

  return tag.kind === "await" || tag.kind === "closing" ||
      tag.kind === "const" || tag.kind === "each"
    ? undefined
    : tag.prefixLength;
}

function findBabelExpressionBoundary(
  text: string,
  filename: string,
): number {
  try {
    parseBabelExpression(text, {
      sourceFilename: filename,
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowYieldOutsideFunction: true,
    });
    return text.length;
  } catch (error) {
    if (
      error instanceof SyntaxError &&
      "pos" in error &&
      typeof error.pos === "number"
    ) {
      return error.pos;
    }

    throw error;
  }
}

function findExcludedRanges(content: string): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];
  const patterns = [
    /<script\b[\s\S]*?<\/script\s*>/gi,
    /<style\b[\s\S]*?<\/style\s*>/gi,
    /<!--[\s\S]*?-->/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match.index === undefined) {
        continue;
      }

      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return ranges.sort((left, right) => left.start - right.start);
}

function findParseSafeMaskRanges(content: string): ExcludedRange[] {
  return [
    ...findTagBodyRanges(content, "script"),
    ...findTagBodyRanges(content, "style"),
    ...findCommentRanges(content),
  ].sort((left, right) => left.start - right.start);
}

function findTagBodyRanges(
  content: string,
  tagName: "script" | "style",
): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`,
    "gi",
  );

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const fullMatch = match[0];
    const body = match[1] ?? "";
    const openTagEnd = fullMatch.indexOf(">") + 1;
    const start = match.index + openTagEnd;

    ranges.push({
      start,
      end: start + body.length,
    });
  }

  return ranges;
}

function findCommentRanges(content: string): ExcludedRange[] {
  const ranges: ExcludedRange[] = [];
  const pattern = /<!--[\s\S]*?-->/g;

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return ranges;
}

function findExcludedRangeAt(
  ranges: ExcludedRange[],
  index: number,
): ExcludedRange | undefined {
  return ranges.find((range) => range.start <= index && index < range.end);
}

function findClosingBrace(content: string, start: number): number {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let templateBraceDepth = 0;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (quote === "'") {
      if (character === "\\" && nextCharacter) {
        index += 1;
        continue;
      }

      if (character === "'") {
        quote = undefined;
      }

      continue;
    }

    if (quote === '"') {
      if (character === "\\" && nextCharacter) {
        index += 1;
        continue;
      }

      if (character === '"') {
        quote = undefined;
      }

      continue;
    }

    if (quote === "`") {
      if (character === "\\" && nextCharacter) {
        index += 1;
        continue;
      }

      if (character === "$" && nextCharacter === "{") {
        templateBraceDepth += 1;
        braceDepth += 1;
        index += 1;
        continue;
      }

      if (character === "}" && templateBraceDepth > 0) {
        templateBraceDepth -= 1;
        braceDepth -= 1;
        continue;
      }

      if (character === "`" && templateBraceDepth === 0) {
        quote = undefined;
      }

      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      index += 2;

      while (index < content.length && content[index] !== "\n") {
        index += 1;
      }

      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      index += 2;

      while (
        index < content.length &&
        !(content[index] === "*" && content[index + 1] === "/")
      ) {
        index += 1;
      }

      index += 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth -= 1;
      continue;
    }

    if (character === "[") {
      bracketDepth += 1;
      continue;
    }

    if (character === "]") {
      bracketDepth -= 1;
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
        return index;
      }

      braceDepth -= 1;
    }
  }

  return -1;
}

function findTopLevelKeyword(text: string, keyword: string): number {
  const boundary = findBabelExpressionBoundary(text, "MarkupBoundary.svelte");

  if (boundary >= text.length) {
    return -1;
  }

  if (!text.startsWith(keyword.trimStart(), boundary)) {
    return -1;
  }

  return trimTrailingWhitespaceIndex(text, boundary);
}

function trimTrailingWhitespaceIndex(text: string, end: number): number {
  let index = end;

  while (index > 0 && /\s/.test(text[index - 1] ?? "")) {
    index -= 1;
  }

  return index;
}

function findAwaitBoundary(text: string): number {
  const thenIndex = findTopLevelKeyword(text, " then ");

  if (thenIndex !== -1) {
    return thenIndex;
  }

  return findTopLevelKeyword(text, " catch ");
}

function getBraceTagInfo(trimmed: string): {
  kind: BraceTagKind;
  prefixLength: number;
} {
  if (trimmed.startsWith("@const ")) {
    return { kind: "const", prefixLength: "@const ".length };
  }

  if (trimmed.startsWith("#if ")) {
    return { kind: "if", prefixLength: "#if ".length };
  }

  if (trimmed.startsWith(":else if ")) {
    return { kind: "else-if", prefixLength: ":else if ".length };
  }

  if (trimmed.startsWith("#each ")) {
    return { kind: "each", prefixLength: "#each ".length };
  }

  if (trimmed.startsWith("#await ")) {
    return { kind: "await", prefixLength: "#await ".length };
  }

  if (trimmed.startsWith("@html ")) {
    return { kind: "html", prefixLength: "@html ".length };
  }

  if (trimmed.startsWith("@render ")) {
    return { kind: "render", prefixLength: "@render ".length };
  }

  if (trimmed.startsWith("@attach ")) {
    return { kind: "attach", prefixLength: "@attach ".length };
  }

  if (trimmed.startsWith("#key ")) {
    return { kind: "key", prefixLength: "#key ".length };
  }

  if (trimmed.startsWith("@debug ")) {
    return { kind: "debug", prefixLength: "@debug ".length };
  }

  if (trimmed.startsWith("...")) {
    return { kind: "spread", prefixLength: "...".length };
  }

  if (
    trimmed.startsWith("/") || trimmed.startsWith(":then") ||
    trimmed.startsWith(":catch") || trimmed === ":else"
  ) {
    return { kind: "closing", prefixLength: 0 };
  }

  return { kind: "plain", prefixLength: 0 };
}

function isEventAttribute(name: string): boolean {
  return name.startsWith("on:") ||
    /^on[a-z]/.test(name);
}

function injectMarkupHelpers(
  magicString: MagicString,
  content: string,
  options: TransformEffectMarkupOptions,
): void {
  if (
    content.includes(
      `const ${MARKUP_HELPER_PREFIX}Values = Object.create(null);`,
    )
  ) {
    return;
  }

  const helperBlock = makeMarkupHelperBlock(options);
  const scriptTagMatch = findInstanceScriptTag(content);

  if (!scriptTagMatch) {
    magicString.prepend(`<script>\n${helperBlock}\n</script>\n\n`);
    return;
  }

  magicString.appendLeft(scriptTagMatch.end, `\n${helperBlock}\n`);
}

function findInstanceScriptTag(content: string): ExcludedRange | undefined {
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const attributes = match[1] ?? "";

    if (
      /\bcontext\s*=\s*["']module["']/.test(attributes) ||
      /\bmodule\b/.test(attributes)
    ) {
      continue;
    }

    const openTag = match[0].indexOf(">") + 1;

    return {
      start: match.index + openTag,
      end: match.index + match[0].length - "</script>".length,
    };
  }

  return undefined;
}

function makeMarkupHelperBlock(
  options: TransformEffectMarkupOptions,
): string {
  const runtimeModuleId = options.runtimeModuleId ?? DEFAULT_RUNTIME_MODULE_ID;
  const effectModuleId = options.effectModuleId ?? DEFAULT_EFFECT_MODULE_ID;
  const svelteModuleId = options.svelteModuleId ?? DEFAULT_SVELTE_MODULE_ID;

  return [
    `import { Effect as ${MARKUP_HELPER_PREFIX}Effect } from "${effectModuleId}";`,
    `import { onDestroy as ${MARKUP_HELPER_PREFIX}OnDestroy } from "${svelteModuleId}";`,
    `import { get_effect_runtime_or_throw as ${MARKUP_HELPER_PREFIX}GetRuntime, run_component_effect as ${MARKUP_HELPER_PREFIX}RunComponentEffect, run_inline_effect as ${MARKUP_HELPER_PREFIX}RunInlineEffect } from "${runtimeModuleId}";`,
    "",
    `const ${MARKUP_HELPER_PREFIX}Values = Object.create(null);`,
    `const ${MARKUP_HELPER_PREFIX}Promises = Object.create(null);`,
    `const ${MARKUP_HELPER_PREFIX}Cleanups = new Map();`,
    `const ${MARKUP_HELPER_PREFIX}ObjectIds = new WeakMap();`,
    `const ${MARKUP_HELPER_PREFIX}PendingStarts = new Set();`,
    `const ${MARKUP_HELPER_PREFIX}Runtime = typeof window === "undefined" ? undefined : ${MARKUP_HELPER_PREFIX}GetRuntime();`,
    `let ${MARKUP_HELPER_PREFIX}Version = $state(0);`,
    `let ${MARKUP_HELPER_PREFIX}NextObjectId = 1;`,
    "",
    `function ${MARKUP_HELPER_PREFIX}Hash(value) {`,
    `  if (value === null) {`,
    `    return "null";`,
    "  }",
    "",
    `  if (value === undefined) {`,
    `    return "undefined";`,
    "  }",
    "",
    `  const type = typeof value;`,
    "",
    `  if (type === "string") {`,
    `    return \`string:\${value}\`;`,
    "  }",
    "",
    `  if (type === "number") {`,
    `    return \`number:\${Object.is(value, -0) ? "-0" : String(value)}\`;`,
    "  }",
    "",
    `  if (type === "bigint") {`,
    `    return \`bigint:\${value.toString()}\`;`,
    "  }",
    "",
    `  if (type === "boolean") {`,
    `    return value ? "boolean:true" : "boolean:false";`,
    "  }",
    "",
    `  if (type === "symbol") {`,
    `    return \`symbol:\${String(value)}\`;`,
    "  }",
    "",
    `  let objectId = ${MARKUP_HELPER_PREFIX}ObjectIds.get(value);`,
    "",
    `  if (objectId === undefined) {`,
    `    objectId = ${MARKUP_HELPER_PREFIX}NextObjectId;`,
    `    ${MARKUP_HELPER_PREFIX}NextObjectId += 1;`,
    `    ${MARKUP_HELPER_PREFIX}ObjectIds.set(value, objectId);`,
    "  }",
    "",
    `  return \`object:\${objectId}\`;`,
    "}",
    "",
    `function ${MARKUP_HELPER_PREFIX}DepsKey(deps) {`,
    `  return deps.map(${MARKUP_HELPER_PREFIX}Hash).join("|");`,
    "}",
    "",
    `function ${MARKUP_HELPER_PREFIX}Value(id, deps, factory, fallback) {`,
    `  if (typeof window === "undefined") {`,
    `    return fallback;`,
    "  }",
    "",
    `  ${MARKUP_HELPER_PREFIX}Version;`,
    "",
    `  const cacheKey = \`\${id}::\${${MARKUP_HELPER_PREFIX}DepsKey(deps)}\`;`,
    "",
    `  if (!${MARKUP_HELPER_PREFIX}Cleanups.has(cacheKey)) {`,
    `    if (!${MARKUP_HELPER_PREFIX}PendingStarts.has(cacheKey)) {`,
    `      ${MARKUP_HELPER_PREFIX}PendingStarts.add(cacheKey);`,
    `      queueMicrotask(() => {`,
    `        ${MARKUP_HELPER_PREFIX}PendingStarts.delete(cacheKey);`,
    "",
    `        if (${MARKUP_HELPER_PREFIX}Cleanups.has(cacheKey)) {`,
    "          return;",
    "        }",
    "",
    `        ${MARKUP_HELPER_PREFIX}Cleanups.set(`,
    "          cacheKey,",
    `          ${MARKUP_HELPER_PREFIX}RunComponentEffect(`,
    `            ${MARKUP_HELPER_PREFIX}Runtime,`,
    `            ${MARKUP_HELPER_PREFIX}Effect.gen(function* () {`,
    `              ${MARKUP_HELPER_PREFIX}Values[cacheKey] = yield* ${MARKUP_HELPER_PREFIX}Effect.gen(factory);`,
    `              ${MARKUP_HELPER_PREFIX}Version += 1;`,
    "            }),",
    "          ),",
    "        );",
    "      });",
    "    }",
    "  }",
    "",
    `  return Object.prototype.hasOwnProperty.call(${MARKUP_HELPER_PREFIX}Values, cacheKey)`,
    `    ? ${MARKUP_HELPER_PREFIX}Values[cacheKey]`,
    "    : fallback;",
    "}",
    "",
    `function ${MARKUP_HELPER_PREFIX}Promise(id, deps, factory) {`,
    `  if (typeof window === "undefined") {`,
    `    return Promise.resolve(undefined);`,
    "  }",
    "",
    `  const cacheKey = \`\${id}::\${${MARKUP_HELPER_PREFIX}DepsKey(deps)}\`;`,
    "",
    `  if (!Object.prototype.hasOwnProperty.call(${MARKUP_HELPER_PREFIX}Promises, cacheKey)) {`,
    `    ${MARKUP_HELPER_PREFIX}Promises[cacheKey] = new Promise((resolve, reject) => {`,
    `      queueMicrotask(() => {`,
    `        ${MARKUP_HELPER_PREFIX}RunInlineEffect(`,
    `          ${MARKUP_HELPER_PREFIX}Runtime,`,
    `          ${MARKUP_HELPER_PREFIX}Effect.gen(factory),`,
    `        ).then(resolve, reject);`,
    "      });",
    `    }).catch((error) => {`,
    `      delete ${MARKUP_HELPER_PREFIX}Promises[cacheKey];`,
    "      throw error;",
    "    });",
    "  }",
    "",
    `  return ${MARKUP_HELPER_PREFIX}Promises[cacheKey];`,
    "}",
    "",
    `function ${MARKUP_HELPER_PREFIX}Run(factory) {`,
    `  if (typeof window === "undefined") {`,
    "    return Promise.resolve(undefined);",
    "  }",
    "",
    `  return ${MARKUP_HELPER_PREFIX}RunInlineEffect(`,
    `    ${MARKUP_HELPER_PREFIX}Runtime,`,
    `    ${MARKUP_HELPER_PREFIX}Effect.gen(factory),`,
    "  );",
    "}",
    "",
    `function ${MARKUP_HELPER_PREFIX}CleanupAll() {`,
    `  for (const cleanup of ${MARKUP_HELPER_PREFIX}Cleanups.values()) {`,
    "    cleanup();",
    "  }",
    "",
    `  ${MARKUP_HELPER_PREFIX}Cleanups.clear();`,
    "}",
    "",
    `${MARKUP_HELPER_PREFIX}OnDestroy(${MARKUP_HELPER_PREFIX}CleanupAll);`,
    `import.meta.hot?.dispose(${MARKUP_HELPER_PREFIX}CleanupAll);`,
  ].join("\n");
}

function indentBlock(text: string, indent: string): string {
  return text.split("\n").map((line) =>
    line.length > 0 ? `${indent}${line}` : line
  ).join("\n");
}
