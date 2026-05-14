import { assertEquals } from "@std/assert";
import { contains_top_level_yield_star, is_function_boundary } from "../../../modules/svelte-effect-runtime/v2/detect.ts";
import ts from "typescript";

function parse_expression(text: string): ts.Node {
  const sf = ts.createSourceFile(
    "test.ts",
    `const x = ${text};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const stmt = sf.statements[0];
  if (!ts.isVariableStatement(stmt)) throw new Error("not a variable statement");
  const decl = stmt.declarationList.declarations[0];
  if (!decl?.initializer) throw new Error("no initializer");
  return decl.initializer;
}

function parse_statement(text: string): ts.Statement {
  const sf = ts.createSourceFile(
    "test.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return sf.statements[0]!;
}

// ─── contains_top_level_yield_star ───────────────────────────

Deno.test("contains_top_level_yield_star: true for bare yield* expression", () => {
  const node = parse_expression("yield* foo()");
  assertEquals(contains_top_level_yield_star(node), true);
});

Deno.test("contains_top_level_yield_star: true for yield* inside $state()", () => {
  const node = parse_expression("$state(yield* getUser(id))");
  assertEquals(contains_top_level_yield_star(node), true);
});

Deno.test("contains_top_level_yield_star: true for yield* inside $derived()", () => {
  const node = parse_expression("$derived(yield* x + 1)");
  assertEquals(contains_top_level_yield_star(node), true);
});

Deno.test("contains_top_level_yield_star: true for yield* in ternary condition", () => {
  const node = parse_expression("yield* check() ? 'a' : 'b'");
  assertEquals(contains_top_level_yield_star(node), true);
});

Deno.test("contains_top_level_yield_star: true for yield* in template literal", () => {
  const node = parse_expression("`${yield* getName()}`");
  assertEquals(contains_top_level_yield_star(node), true);
});

Deno.test("contains_top_level_yield_star: false for plain expression", () => {
  const node = parse_expression("getUser(id)");
  assertEquals(contains_top_level_yield_star(node), false);
});

Deno.test("contains_top_level_yield_star: false for yield* inside arrow function", () => {
  const node = parse_expression("() => yield* foo()");
  assertEquals(contains_top_level_yield_star(node), false);
});

Deno.test("contains_top_level_yield_star: false for yield* inside function expression", () => {
  const node = parse_expression("Effect.gen(function* () { yield* foo(); })");
  assertEquals(contains_top_level_yield_star(node), false);
});

Deno.test("contains_top_level_yield_star: false for yield* inside nested generator", () => {
  const node = parse_expression("function* gen() { yield* bar(); }");
  assertEquals(contains_top_level_yield_star(node), false);
});

Deno.test("contains_top_level_yield_star: false for yield* in method declaration", () => {
  const sf = ts.createSourceFile(
    "test.ts",
    `class Foo { *method() { yield* bar(); } }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assertEquals(contains_top_level_yield_star(sf.statements[0]), false);
});

// ─── is_function_boundary ────────────────────────────────────

Deno.test("is_function_boundary: true for arrow function", () => {
  const sf = ts.createSourceFile(
    "test.ts",
    `const f = () => {};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const decl = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0];
  assertEquals(is_function_boundary(decl.initializer!), true);
});

Deno.test("is_function_boundary: true for function declaration", () => {
  const stmt = parse_statement("function foo() {}");
  assertEquals(is_function_boundary(stmt), true);
});

Deno.test("is_function_boundary: true for function expression", () => {
  const sf = ts.createSourceFile(
    "test.ts",
    `const f = function() {};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const decl = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0];
  assertEquals(is_function_boundary(decl.initializer!), true);
});

Deno.test("is_function_boundary: true for method declaration", () => {
  const sf = ts.createSourceFile(
    "test.ts",
    `class Foo { method() {} }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const class_decl = sf.statements[0];
  const method = ts.isClassDeclaration(class_decl) ? class_decl.members[0] : null;
  assertEquals(is_function_boundary(method!), true);
});

Deno.test("is_function_boundary: false for variable declaration", () => {
  const stmt = parse_statement("const x = 42;");
  assertEquals(is_function_boundary(stmt), false);
});

Deno.test("is_function_boundary: false for expression statement", () => {
  const stmt = parse_statement("foo();");
  assertEquals(is_function_boundary(stmt), false);
});

Deno.test("is_function_boundary: false for import declaration", () => {
  const stmt = parse_statement(`import { foo } from "bar";`);
  assertEquals(is_function_boundary(stmt), false);
});
