import MagicString, { type SourceMap } from "magic-string";
import ts from "typescript";
import type { EffectPreprocessOptions } from "$/preprocess.ts";

const DEFAULT_RUNTIME_MODULE_ID = "svelte-effect-runtime";
const DEFAULT_EFFECT_MODULE_ID = "effect";
const DEFAULT_SVELTE_MODULE_ID = "svelte";

const RUNE_IDENTIFIERS = new Set([
  "$bindable",
  "$derived",
  "$effect",
  "$host",
  "$inspect",
  "$props",
  "$state",
]);

interface TransformEffectScriptOptions extends EffectPreprocessOptions {
  filename: string;
}

interface TransformEffectScriptResult {
  code: string;
  map: SourceMap;
  relocations: Array<TransformRelocation>;
}

interface VariableStatementTransform {
  effectTexts: string[];
  hoistedText: string;
  loweredBindings: string[];
  pendingRelocations: Array<PendingRelocation>;
  usesPendingYieldHelper: boolean;
}

interface TransformRelocation {
  originalStart: number;
  originalEnd: number;
  generatedStart: number;
  generatedEnd: number;
}

interface PendingRelocation {
  originalStart: number;
  originalEnd: number;
  generatedSnippet: string;
  generatedInnerStart: number;
  generatedInnerEnd: number;
}

interface StateDeclarationTransform {
  code: string;
  pendingRelocations: Array<PendingRelocation>;
}

interface LoweredDeclarationHelper {
  declarationText: string;
  stateTypeText: string;
  assignmentExpression: string;
  expressionRelocation: PendingRelocation;
  tempName?: string;
}

const HOISTED_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.EmptyStatement,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
]);

const HOISTED_CALL_IDENTIFIERS = new Set([
  "$effect",
  "__svelteEffectRuntimeMarkupOnDestroy",
  "onDestroy",
]);

export function transformEffectScript(
  content: string,
  options: TransformEffectScriptOptions,
): TransformEffectScriptResult {
  const sourceFile = ts.createSourceFile(
    options.filename,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const effectStatements: Array<{ node: ts.Statement; text: string }> = [];
  const runtimeStatements: string[] = [];
  const pendingRelocations: Array<PendingRelocation> = [];
  const magicString = new MagicString(content);
  const effectBoundBindings = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      if (isGeneratedMarkupHelperStatement(statement, content)) {
        continue;
      }

      const transformed = transformVariableStatement(
        statement,
        content,
        options.filename,
        effectBoundBindings,
      );

      if (transformed.hoistedText.length === 0) {
        magicString.remove(statement.getFullStart(), statement.end);
      } else {
        magicString.overwrite(
          statement.getStart(sourceFile),
          statement.end,
          transformed.hoistedText,
        );
      }

      runtimeStatements.push(...transformed.effectTexts);
      pendingRelocations.push(...transformed.pendingRelocations);
      for (const bindingName of transformed.loweredBindings) {
        effectBoundBindings.add(bindingName);
      }
      continue;
    }

    if (isHoistedExpressionStatement(statement)) {
      continue;
    }

    if (isHoistedStatement(statement)) {
      continue;
    }

    if (containsTopLevelAwait(statement)) {
      throw new Error(
        `${options.filename}: top-level await is not supported in <script effect>. Use yield* Effect.promise(...) or yield* Effect.tryPromise(...) instead.`,
      );
    }

    effectStatements.push({
      node: statement,
      text: normalizeStatementText(sliceNode(content, statement)),
    });
    pendingRelocations.push({
      originalStart: statement.getStart(sourceFile),
      originalEnd: statement.end,
      generatedSnippet: normalizeStatementText(sliceNode(content, statement)),
      generatedInnerStart: 0,
      generatedInnerEnd: normalizeStatementText(sliceNode(content, statement))
        .length,
    });
  }

  for (const statement of [...effectStatements].reverse()) {
    magicString.remove(statement.node.getFullStart(), statement.node.end);
  }

  const allRuntimeStatements = [
    ...runtimeStatements,
    ...effectStatements.map((statement) => statement.text),
  ];

  if (allRuntimeStatements.length > 0) {
    magicString.prepend(makeInjectedImports(options));
    magicString.append(makeRuntimeBlock(allRuntimeStatements));
  }

  const code = magicString.toString();

  return {
    code,
    map: magicString.generateMap({
      hires: true,
      includeContent: true,
      source: options.filename,
    }),
    relocations: resolvePendingRelocations(pendingRelocations, code),
  };
}

function isHoistedStatement(statement: ts.Statement): boolean {
  return HOISTED_KINDS.has(statement.kind);
}

function isHoistedExpressionStatement(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement)) {
    return false;
  }

  if (!ts.isCallExpression(statement.expression)) {
    return false;
  }

  return getCalledIdentifierText(statement.expression.expression) !==
      undefined &&
    HOISTED_CALL_IDENTIFIERS.has(
      getCalledIdentifierText(statement.expression.expression)!,
    );
}

function getCalledIdentifierText(
  expression: ts.Expression,
): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const base = getCalledIdentifierText(expression.expression);
    return base ? `${base}.${expression.name.text}` : expression.name.text;
  }

  return undefined;
}

function transformVariableStatement(
  statement: ts.VariableStatement,
  content: string,
  filename: string,
  effectBoundBindings: ReadonlySet<string>,
): VariableStatementTransform {
  if ((statement.modifiers?.length ?? 0) > 0) {
    validateModifiedVariableStatement(statement, content, filename);
    return {
      effectTexts: [],
      hoistedText: normalizeStatementText(sliceNode(content, statement)),
      loweredBindings: [],
      pendingRelocations: [],
      usesPendingYieldHelper: false,
    };
  }

  const effectTexts: string[] = [];
  const hoistedDeclarations: string[] = [];
  const loweredBindings: string[] = [];
  const pendingRelocations: Array<PendingRelocation> = [];

  for (const declaration of statement.declarationList.declarations) {
    if (
      declaration.initializer && containsTopLevelAwait(declaration.initializer)
    ) {
      const statementText = normalizeStatementText(
        sliceNode(content, statement),
      );

      throw new Error(
        `${filename}: declarations in <script effect> cannot depend on await.\nUse yield* Effect.promise(...) or yield* Effect.tryPromise(...) instead.\n\nProblematic statement:\n${statementText}`,
      );
    }

    if (declaration.initializer && isRuneInitializer(declaration.initializer)) {
      const renderedDeclaration = `${
        getDeclarationKind(statement.declarationList.flags)
      } ${normalizeStatementText(sliceNode(content, declaration))};`;
      hoistedDeclarations.push(renderedDeclaration);
      pendingRelocations.push(
        ...make_declaration_relocations(
          declaration,
          renderedDeclaration,
          content,
        ),
      );
      continue;
    }

    if (
      shouldHoistDeclaration(
        statement.declarationList.flags,
        declaration,
        effectBoundBindings,
      )
    ) {
      const renderedDeclaration = `${
        getDeclarationKind(statement.declarationList.flags)
      } ${normalizeStatementText(sliceNode(content, declaration))};`;
      hoistedDeclarations.push(renderedDeclaration);
      pendingRelocations.push(
        ...make_declaration_relocations(
          declaration,
          renderedDeclaration,
          content,
        ),
      );
      continue;
    }

    const bindingNames = extractBindingNames(declaration.name);
    const helper = create_lowered_declaration_helper(declaration, content);

    if (helper) {
      hoistedDeclarations.push(helper.declarationText);
      pendingRelocations.push(helper.expressionRelocation);
    }

    if (helper?.tempName) {
      hoistedDeclarations.push(
        makeTypedStateBinding(helper.tempName, helper.stateTypeText),
      );
    }

    for (const bindingName of bindingNames) {
      const stateDeclaration = makeStateDeclaration(
        bindingName,
        declaration,
        content,
        helper?.tempName ? null : helper?.stateTypeText,
      );
      hoistedDeclarations.push(stateDeclaration.code);
      pendingRelocations.push(...stateDeclaration.pendingRelocations);
    }
    loweredBindings.push(...bindingNames);

    if (declaration.initializer) {
      if (helper?.tempName) {
        effectTexts.push(
          `${helper.tempName} = ${helper.assignmentExpression};`,
        );
        effectTexts.push(
          makeEffectAssignment(
            declaration.name,
            helper.tempName,
            content,
          ),
        );
      } else {
        const effectAssignment = helper
          ? `${bindingNames[0]} = ${helper.assignmentExpression};`
          : makeEffectAssignment(
            declaration.name,
            declaration.initializer,
            content,
          );
        effectTexts.push(effectAssignment);
        if (!helper) {
          pendingRelocations.push(
            makeEffectAssignmentRelocation(
              declaration.initializer,
              effectAssignment,
              content,
            ),
          );
        }
      }
    }
  }

  return {
    effectTexts,
    hoistedText: hoistedDeclarations.join("\n"),
    loweredBindings,
    pendingRelocations,
    usesPendingYieldHelper: false,
  };
}

function shouldHoistDeclaration(
  flags: ts.NodeFlags,
  declaration: ts.VariableDeclaration,
  effectBoundBindings: ReadonlySet<string>,
): boolean {
  if ((flags & ts.NodeFlags.Const) === 0) {
    return false;
  }

  if (!declaration.initializer) {
    return false;
  }

  if (
    containsYieldStar(declaration.initializer) ||
    containsTopLevelAwait(declaration.initializer)
  ) {
    return false;
  }

  return !referencesEffectBoundBindings(
    declaration.initializer,
    effectBoundBindings,
  );
}

function referencesEffectBoundBindings(
  node: ts.Node,
  effectBoundBindings: ReadonlySet<string>,
): boolean {
  const localScopes: Array<Set<string>> = [new Set()];
  let found = false;

  const visit = (current: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isArrowFunction(current) || ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current)
    ) {
      const scope = new Set<string>();

      if (current.name) {
        scope.add(current.name.text);
      }

      for (const parameter of current.parameters) {
        declareBindingInto(scope, parameter.name);
      }

      localScopes.unshift(scope);
      current.forEachChild(visit);
      localScopes.shift();
      return;
    }

    if (ts.isIdentifier(current)) {
      if (
        !isSkippedReference(current) &&
        effectBoundBindings.has(current.text) &&
        !localScopes.some((scope) => scope.has(current.text))
      ) {
        found = true;
      }

      return;
    }

    current.forEachChild(visit);
  };

  const declareBindingInto = (
    scope: Set<string>,
    name: ts.BindingName,
  ): void => {
    if (ts.isIdentifier(name)) {
      scope.add(name.text);
      return;
    }

    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }

      declareBindingInto(scope, element.name);
    }
  };

  visit(node);
  return found;
}

function isSkippedReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;

  return ts.isPropertyAccessExpression(parent) && parent.name === identifier ||
    ts.isPropertyAssignment(parent) && parent.name === identifier ||
    ts.isShorthandPropertyAssignment(parent) &&
      parent.objectAssignmentInitializer === identifier ||
    ts.isBindingElement(parent) && parent.propertyName === identifier ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isLabeledStatement(parent) && parent.label === identifier;
}

function isGeneratedMarkupHelperStatement(
  statement: ts.VariableStatement,
  content: string,
): boolean {
  return statement.declarationList.declarations.every((declaration) =>
    extractBindingNames(declaration.name).every((name) =>
      name.startsWith("__svelteEffectRuntimeMarkup")
    ) ||
    normalizeStatementText(sliceNode(content, declaration)).startsWith(
      "__svelteEffectRuntimeMarkup",
    )
  );
}

function validateModifiedVariableStatement(
  statement: ts.VariableStatement,
  content: string,
  filename: string,
): void {
  for (const declaration of statement.declarationList.declarations) {
    if (
      declaration.initializer &&
      (containsYieldStar(declaration.initializer) ||
        containsTopLevelAwait(declaration.initializer))
    ) {
      const statementText = normalizeStatementText(
        sliceNode(content, statement),
      );

      throw new Error(
        `${filename}: declarations with modifiers cannot depend on yield* or await in <script effect> right now.\nSplit the declaration into a plain top-level binding and assign inside the effect body instead.\n\nProblematic statement:\n${statementText}`,
      );
    }
  }
}

function getDeclarationKind(flags: ts.NodeFlags): "const" | "let" | "var" {
  if ((flags & ts.NodeFlags.Const) !== 0) {
    return "const";
  }

  if ((flags & ts.NodeFlags.Let) !== 0) {
    return "let";
  }

  return "var";
}

function makeStateDeclaration(
  name: string,
  declaration: ts.VariableDeclaration,
  content: string,
  inferredTypeText?: string | null,
): StateDeclarationTransform {
  let stateTypeText: string | null = null;

  if (ts.isIdentifier(declaration.name) && declaration.type) {
    stateTypeText = normalizeStatementText(
      sliceNode(content, declaration.type),
    );
  } else if (inferredTypeText) {
    stateTypeText = inferredTypeText;
  }

  const code = stateTypeText
    ? makeTypedStateBinding(name, stateTypeText)
    : `let ${name} = $state<any>(undefined);`;

  const nameStart = code.indexOf(name);
  const pendingRelocations: Array<PendingRelocation> = [{
    originalStart: find_binding_name_start(declaration.name, name),
    originalEnd: find_binding_name_end(declaration.name, name),
    generatedSnippet: "",
    generatedInnerStart: nameStart,
    generatedInnerEnd: nameStart + name.length,
  }];

  pendingRelocations[0] = {
    ...pendingRelocations[0],
    generatedSnippet: code,
  };

  return {
    code,
    pendingRelocations,
  };
}

function makeEffectAssignment(
  name: ts.BindingName,
  initializer: ts.Expression | string,
  content: string,
): string {
  const target = normalizeStatementText(sliceNode(content, name));
  const expression = typeof initializer === "string"
    ? initializer
    : normalizeStatementText(sliceNode(content, initializer));

  if (ts.isIdentifier(name)) {
    return `${target} = ${expression};`;
  }

  return `(${target} = ${expression});`;
}

function makeEffectAssignmentRelocation(
  initializer: ts.Expression,
  effectAssignment: string,
  content: string,
): PendingRelocation {
  const expression = normalizeStatementText(sliceNode(content, initializer));
  const generatedInnerStart = effectAssignment.lastIndexOf(expression);

  return {
    originalStart: initializer.getStart(),
    originalEnd: initializer.end,
    generatedSnippet: effectAssignment,
    generatedInnerStart,
    generatedInnerEnd: generatedInnerStart + expression.length,
  };
}

function extractBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  const names: string[] = [];

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    names.push(...extractBindingNames(element.name));
  }

  return names;
}

function isRuneInitializer(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) {
    return false;
  }

  return isRuneCallee(expression.expression);
}

function isRuneCallee(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return RUNE_IDENTIFIERS.has(expression.text);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return isRuneCallee(expression.expression);
  }

  return false;
}

function containsYieldStar(node: ts.Node): boolean {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
    ts.isIdentifier(node.left) &&
    node.left.text === "yield"
  ) {
    return true;
  }

  return node.getChildren().some((child) =>
    isFunctionBoundary(child) ? false : containsYieldStar(child)
  );
}

function getYieldOperand(node: ts.Node | undefined): ts.Expression | null {
  if (
    node &&
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
    ts.isIdentifier(node.left) &&
    node.left.text === "yield"
  ) {
    return node.right;
  }

  return null;
}

function containsTopLevelAwait(node: ts.Node): boolean {
  if (ts.isAwaitExpression(node)) {
    return true;
  }

  return node.getChildren().some((child) =>
    isFunctionBoundary(child) ? false : containsTopLevelAwait(child)
  );
}

function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node);
}

function sliceNode(content: string, node: ts.Node): string {
  return content.slice(node.getFullStart(), node.end);
}

function normalizeStatementText(text: string): string {
  return text.trim();
}

function indentBlock(text: string, indent: string): string {
  return text.split("\n").map((line) =>
    line.length > 0 ? `${indent}${line}` : line
  ).join("\n");
}

function makeInjectedImports(
  options: TransformEffectScriptOptions,
): string {
  const runtimeModuleId = options.runtimeModuleId ?? DEFAULT_RUNTIME_MODULE_ID;
  const effectModuleId = options.effectModuleId ?? DEFAULT_EFFECT_MODULE_ID;
  const svelteModuleId = options.svelteModuleId ?? DEFAULT_SVELTE_MODULE_ID;

  const lines = [
    `import { onMount as __svelteEffectRuntimeOnMount } from "${svelteModuleId}";`,
    `import { Effect as __svelteEffectRuntimeEffect } from "${effectModuleId}";`,
    `import { get_effect_runtime_or_throw as __svelteEffectRuntimeGetRuntime, run_component_effect as __svelteEffectRuntimeRunComponentEffect } from "${runtimeModuleId}";`,
    `type __svelteEffectRuntimeYielded<T> = T extends __svelteEffectRuntimeEffect.Effect<infer A, any, any> ? A : T;`,
  ];

  lines.push("");
  return lines.join("\n");
}

function makeTypedStateBinding(name: string, stateTypeText: string): string {
  return `let ${name}: ${stateTypeText} = $state(undefined as unknown as ${stateTypeText});`;
}

function create_lowered_declaration_helper(
  declaration: ts.VariableDeclaration,
  content: string,
): LoweredDeclarationHelper | null {
  if (declaration.type || !declaration.initializer) {
    return null;
  }

  const bindingNames = extractBindingNames(declaration.name);
  const suffix = declaration.getStart();
  const baseName = bindingNames[0] ?? "binding";
  const helperName = `__svelteEffectRuntime_${baseName}_${suffix}`;
  const expressionNode = getYieldOperand(declaration.initializer) ??
    declaration.initializer;
  const expressionText = normalizeStatementText(
    sliceNode(content, expressionNode),
  );
  const declarationText = `const ${helperName} = () => ${expressionText};`;
  const yieldedExpression = getYieldOperand(declaration.initializer);
  const stateTypeText = yieldedExpression
    ? `__svelteEffectRuntimeYielded<ReturnType<typeof ${helperName}>>`
    : `ReturnType<typeof ${helperName}>`;
  const assignmentExpression = yieldedExpression
    ? `yield* ${helperName}()`
    : `${helperName}()`;

  return {
    declarationText,
    stateTypeText,
    assignmentExpression,
    tempName: ts.isIdentifier(declaration.name)
      ? undefined
      : `__svelteEffectRuntimeTemp_${suffix}`,
    expressionRelocation: {
      originalStart: expressionNode.getStart(),
      originalEnd: expressionNode.end,
      generatedSnippet: declarationText,
      generatedInnerStart: declarationText.lastIndexOf(expressionText),
      generatedInnerEnd: declarationText.lastIndexOf(expressionText) +
        expressionText.length,
    },
  };
}

function make_declaration_relocations(
  declaration: ts.VariableDeclaration,
  renderedDeclaration: string,
  content: string,
): Array<PendingRelocation> {
  const relocations: Array<PendingRelocation> = [];

  if (ts.isIdentifier(declaration.name)) {
    const nameStart = renderedDeclaration.indexOf(declaration.name.text);
    relocations.push({
      originalStart: declaration.name.getStart(),
      originalEnd: declaration.name.end,
      generatedSnippet: renderedDeclaration,
      generatedInnerStart: nameStart,
      generatedInnerEnd: nameStart + declaration.name.text.length,
    });
  }

  if (declaration.initializer) {
    const initializerText = normalizeStatementText(
      sliceNode(content, declaration.initializer),
    );
    const initializerStart = renderedDeclaration.lastIndexOf(initializerText);
    if (initializerStart >= 0) {
      relocations.push({
        originalStart: declaration.initializer.getStart(),
        originalEnd: declaration.initializer.end,
        generatedSnippet: renderedDeclaration,
        generatedInnerStart: initializerStart,
        generatedInnerEnd: initializerStart + initializerText.length,
      });
    }
  }

  return relocations;
}

function find_binding_name_start(
  name: ts.BindingName,
  bindingName: string,
): number {
  if (ts.isIdentifier(name)) {
    return name.text === bindingName ? name.getStart() : -1;
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    const start = find_binding_name_start(element.name, bindingName);
    if (start !== -1) {
      return start;
    }
  }

  return -1;
}

function find_binding_name_end(
  name: ts.BindingName,
  bindingName: string,
): number {
  if (ts.isIdentifier(name)) {
    return name.text === bindingName ? name.end : -1;
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    const end = find_binding_name_end(element.name, bindingName);
    if (end !== -1) {
      return end;
    }
  }

  return -1;
}

function makeRuntimeBlock(statements: string[]): string {
  const body = statements.map((statement) => indentBlock(statement, "    "))
    .join("\n\n");

  return [
    "",
    "const __svelteEffectRuntimeProgram = __svelteEffectRuntimeEffect.gen(function* () {",
    body,
    "});",
    "",
    "__svelteEffectRuntimeOnMount(() => {",
    "  const __svelteEffectRuntimeCleanup = __svelteEffectRuntimeRunComponentEffect(",
    "    __svelteEffectRuntimeGetRuntime(),",
    "    __svelteEffectRuntimeProgram,",
    "  );",
    "",
    "  import.meta.hot?.dispose(__svelteEffectRuntimeCleanup);",
    "  return __svelteEffectRuntimeCleanup;",
    "});",
    "",
  ].join("\n");
}

function resolvePendingRelocations(
  pendingRelocations: Array<PendingRelocation>,
  code: string,
): Array<TransformRelocation> {
  const relocations: Array<TransformRelocation> = [];
  let searchStart = 0;

  for (const relocation of pendingRelocations) {
    const generatedStart = code.indexOf(
      relocation.generatedSnippet,
      searchStart,
    );

    if (generatedStart === -1) {
      continue;
    }

    searchStart = generatedStart + relocation.generatedSnippet.length;
    relocations.push({
      originalStart: relocation.originalStart,
      originalEnd: relocation.originalEnd,
      generatedStart: generatedStart + relocation.generatedInnerStart,
      generatedEnd: generatedStart + relocation.generatedInnerEnd,
    });
  }

  return relocations;
}
