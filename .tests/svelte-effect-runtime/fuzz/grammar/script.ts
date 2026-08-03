import * as fc from "fast-check";

/**
 * Grammar-directed generator for `<script effect>` bodies.
 *
 * Random bytes never survive the TypeScript parser, so nothing downstream of it
 * would ever be exercised. This module instead generates syntactically valid SER
 * source from a catalog of statement shapes, so every generated program reaches
 * the lowering phases that actually contain the interesting offset arithmetic.
 */

/**
 * How the transform is expected to treat a statement shape.
 *
 * `effect` shapes carry a top-level `yield*` and must lower. `inert` shapes have
 * no top-level `yield*` and must survive untouched. `rejected` shapes must fail
 * with a tagged `PreprocessError`.
 */
export type StatementKind = "effect" | "inert" | "rejected";

export interface StatementShape {
	readonly id: string;
	readonly kind: StatementKind;
	readonly render: (index: number, effect: string) => string;
}

export interface StatementSpec {
	readonly shape_id: string;
	readonly effect: string;
	readonly trivia: string;
}

export interface ScriptProgramSpec {
	readonly imports: readonly string[];
	readonly shadows: readonly string[];
	readonly statements: readonly StatementSpec[];
	readonly trailing_import: boolean;
	readonly indent: string;
	readonly line_ending: string;
	readonly trailing_newline: boolean;
}

interface ImportSpec {
	readonly text: string;
	readonly bindings: readonly string[];
}

/**
 * Effect-valued expressions used as the operand of every generated `yield*`.
 * Shapes vary in nesting depth and in whether they contain a function boundary,
 * because the lowering walk stops at boundaries and the relocation search keys
 * on the operand text.
 */
const effect_expressions: readonly string[] = [
	"Load()",
	"Load(id)",
	"Service.load(id)",
	"Effect.succeed(1)",
	"Load(id).pipe(Effect.map((entry) => entry))",
	"Load({ id, limit: 10 })",
	"(Load(id))",
	"Load(\n\t\tid,\n\t)",
	`Load("🎉 astral")`,
];

/**
 * Leading trivia attached to a statement. Comments are the interesting case:
 * several lowering paths slice from `getFullStart()`, so trivia lands inside
 * generated code and has previously produced malformed output.
 */
const trivia_options: readonly string[] = [
	"",
	"/** Loads a value. */\n",
	"/**\n * Loads a value.\n * Second line.\n */\n",
	"// plain comment\n",
	"/* inline */ ",
	"\n",
	/** Astral characters cost two UTF-16 units each, which shifts every offset. */
	"/** Ünïcode — 🎉🎉 */\n",
	"// 🎉\n",
];

/**
 * Imports the transform inspects when deciding which runtime bindings it must
 * inject and under which local alias.
 */
const import_catalog: readonly ImportSpec[] = [
	{ text: `import { Effect } from "effect";`, bindings: ["Effect"] },
	{ text: `import { Effect, Layer } from "effect";`, bindings: ["Effect", "Layer"] },
	{ text: `import * as Effect from "effect";`, bindings: ["Effect"] },
	{ text: `import { untrack } from "svelte";`, bindings: ["untrack"] },
	{ text: `import { onDestroy } from "svelte";`, bindings: ["onDestroy"] },
	{ text: `import { onMount } from "svelte";`, bindings: ["onMount"] },
	{
		text: `import { get_dispatcher } from "svelte-effect-runtime/internal/generators";`,
		bindings: ["get_dispatcher"],
	},
	{
		text: `import { ToEffect } from "svelte-effect-runtime/internal/generators";`,
		bindings: ["ToEffect"],
	},
	{ text: `import { Load } from "./data.remote.ts";`, bindings: ["Load"] },
	{ text: `import type { User } from "./types.ts";`, bindings: ["User"] },
	{ text: `import Fallback from "./fallback.ts";`, bindings: ["Fallback"] },
];

/**
 * Top-level declarations that collide with names the transform wants to
 * generate, forcing the name allocator to pick an alias.
 */
const shadow_catalog: readonly string[] = [
	"Effect",
	"untrack",
	"onDestroy",
	"get_dispatcher",
	"ToEffect",
	"YieldSuccess",
	"ComponentScopeRef",
	"__SER___scope",
	"__SER___program",
	"__SER___dispatcher",
	"__SER___cancel",
];

const statement_shapes: readonly StatementShape[] = [
	/** Effect shapes — a top-level `yield*` the transform must lower. */
	{
		id: "const_binding",
		kind: "effect",
		render: (index, effect) => `const value_${index} = yield* ${effect};`,
	},
	{
		id: "let_binding",
		kind: "effect",
		render: (index, effect) => `let value_${index} = yield* ${effect};`,
	},
	{
		id: "bare_yield",
		kind: "effect",
		render: (_index, effect) => `yield* ${effect};`,
	},
	{
		id: "assignment",
		kind: "effect",
		render: (index, effect) => `let value_${index};\nvalue_${index} = yield* ${effect};`,
	},
	{
		id: "compound_assignment",
		kind: "effect",
		render: (index, effect) => `let value_${index} = 0;\nvalue_${index} += yield* ${effect};`,
	},
	{
		id: "object_destructuring",
		kind: "effect",
		render: (index, effect) => `const { first_${index}, second_${index} } = yield* ${effect};`,
	},
	{
		id: "array_destructuring",
		kind: "effect",
		render: (index, effect) => `const [head_${index}, tail_${index}] = yield* ${effect};`,
	},
	{
		id: "nested_call",
		kind: "effect",
		render: (index, effect) => `const value_${index} = normalize(yield* ${effect});`,
	},
	{
		id: "repeated_yield",
		kind: "effect",
		render: (index, effect) =>
			`const value_${index} = (yield* ${effect}) ?? (yield* ${effect});`,
	},
	{
		id: "member_call",
		kind: "effect",
		render: (_index, effect) => `console.log(yield* ${effect});`,
	},
	{
		id: "if_statement",
		kind: "effect",
		render: (index, effect) => `if (yield* ${effect}) { record(${index}); }`,
	},
	{
		id: "for_of_statement",
		kind: "effect",
		render: (_index, effect) => `for (const entry of yield* ${effect}) { record(entry); }`,
	},
	{
		id: "while_statement",
		kind: "effect",
		render: (_index, effect) => `while (yield* ${effect}) { break; }`,
	},
	{
		id: "try_statement",
		kind: "effect",
		render: (_index, effect) => `try { yield* ${effect}; } catch (issue) { record(issue); }`,
	},
	{
		id: "switch_statement",
		kind: "effect",
		render: (_index, effect) => `switch (yield* ${effect}) { default: break; }`,
	},
	{
		id: "state_rune",
		kind: "effect",
		render: (index, effect) => `let value_${index} = $state(yield* ${effect});`,
	},
	{
		id: "derived_rune",
		kind: "effect",
		render: (index, effect) => `const value_${index} = $derived(yield* ${effect});`,
	},
	{
		id: "object_literal",
		kind: "effect",
		render: (index, effect) => `const value_${index} = { field: yield* ${effect} };`,
	},
	{
		id: "array_literal",
		kind: "effect",
		render: (index, effect) => `const value_${index} = [yield* ${effect}];`,
	},
	{
		id: "multi_declarator_first",
		kind: "effect",
		render: (index, effect) =>
			`const value_${index} = yield* ${effect}, plain_${index} = ${index};`,
	},
	{
		id: "multi_declarator_second",
		kind: "effect",
		render: (index, effect) =>
			`const plain_${index} = ${index}, value_${index} = yield* ${effect};`,
	},
	{
		id: "template_literal",
		kind: "effect",
		render: (index, effect) => `const value_${index} = \`prefix \${yield* ${effect}} suffix\`;`,
	},
	{
		id: "ternary",
		kind: "effect",
		render: (index, effect) =>
			`const value_${index} = ${index} > 0 ? yield* ${effect} : undefined;`,
	},
	{
		id: "parenthesized",
		kind: "effect",
		render: (index, effect) => `const value_${index} = (yield* ${effect});`,
	},
	{
		id: "exported_const",
		kind: "effect",
		render: (index, effect) => `export const value_${index} = yield* ${effect};`,
	},
	{
		id: "exported_let",
		kind: "effect",
		render: (index, effect) => `export let value_${index} = yield* ${effect};`,
	},
	{
		id: "block_statement",
		kind: "effect",
		render: (index, effect) => `{ const value_${index} = yield* ${effect}; }`,
	},
	{
		id: "as_cast",
		kind: "effect",
		render: (index, effect) => `const value_${index} = (yield* ${effect}) as string;`,
	},
	{
		id: "non_null_assertion",
		kind: "effect",
		render: (index, effect) => `const value_${index} = (yield* ${effect})!;`,
	},
	{
		id: "optional_chain",
		kind: "effect",
		render: (index, effect) => `const value_${index} = (yield* ${effect})?.field;`,
	},
	{
		id: "spread_element",
		kind: "effect",
		render: (index, effect) => `const value_${index} = [...(yield* ${effect})];`,
	},
	{
		id: "nested_destructuring",
		kind: "effect",
		render: (index, effect) =>
			`const { outer_${index}: { inner_${index} } } = yield* ${effect};`,
	},
	{
		id: "default_destructuring",
		kind: "effect",
		render: (index, effect) => `const { field_${index} = ${index} } = yield* ${effect};`,
	},
	{
		id: "element_access_assignment",
		kind: "effect",
		render: (index, effect) => `store[${index}] = yield* ${effect};`,
	},
	{
		id: "trailing_comment_declarator",
		kind: "effect",
		render: (index, effect) =>
			`const value_${index} = yield* ${effect} /* tail */, plain_${index} = ${index};`,
	},
	{
		id: "sibling_arrow_argument",
		kind: "effect",
		render: (index, effect) => `const value_${index} = wrap(yield* ${effect}, () => ${index});`,
	},
	{
		id: "no_semicolon_binding",
		kind: "effect",
		render: (index, effect) => `const value_${index} = yield* ${effect}`,
	},
	{
		id: "no_semicolon_bare_yield",
		kind: "effect",
		render: (_index, effect) => `yield* ${effect}`,
	},

	/** Inert shapes — no top-level `yield*`, so the transform must not alter them. */
	{
		id: "plain_const",
		kind: "inert",
		render: (index) => `const plain_${index} = ${index};`,
	},
	{
		id: "plain_state_rune",
		kind: "inert",
		render: (index) => `let state_${index} = $state(${index});`,
	},
	{
		id: "plain_derived_rune",
		kind: "inert",
		render: (index) => `const derived_${index} = $derived(${index} + 1);`,
	},
	{
		id: "function_declaration",
		kind: "inert",
		render: (index) => `function helper_${index}() { return ${index}; }`,
	},
	{
		id: "plain_effect_rune",
		kind: "inert",
		render: (index) => `$effect(() => { record(${index}); });`,
	},
	{
		id: "class_declaration",
		kind: "inert",
		render: (index) => `class Holder_${index} { value = ${index}; }`,
	},
	{
		id: "async_arrow",
		kind: "inert",
		render: (index) => `const loader_${index} = async () => { await ready(${index}); };`,
	},
	{
		id: "type_alias",
		kind: "inert",
		render: (index) => `type Alias_${index} = string;`,
	},
	{
		id: "interface_declaration",
		kind: "inert",
		render: (index) => `interface Shape_${index} { value: number; }`,
	},
	{
		id: "exported_plain_const",
		kind: "inert",
		render: (index) => `export const exported_${index} = ${index};`,
	},
	{
		id: "top_level_await",
		kind: "inert",
		render: (index) => `const ready_${index} = await ready(${index});`,
	},

	/** Rejected shapes — must fail with a tagged `PreprocessError`. */
	{
		id: "effect_rune_callback",
		kind: "rejected",
		render: (_index, effect) => `$effect(() => { yield* ${effect}; });`,
	},
	{
		id: "effect_pre_rune_callback",
		kind: "rejected",
		render: (_index, effect) => `$effect.pre(() => { yield* ${effect}; });`,
	},
	{
		id: "derived_by_rune_callback",
		kind: "rejected",
		render: (index, effect) => `const value_${index} = $derived.by(() => yield* ${effect});`,
	},
	{
		id: "props_rune",
		kind: "rejected",
		render: (index, effect) => `const value_${index} = $props(yield* ${effect});`,
	},
	{
		id: "inspect_rune",
		kind: "rejected",
		render: (_index, effect) => `$inspect(yield* ${effect});`,
	},
	{
		id: "class_member",
		kind: "rejected",
		render: (index, effect) => `class Holder_${index} { value = yield* ${effect}; }`,
	},
	{
		id: "await_mixed_with_yield",
		kind: "rejected",
		render: (_index, effect) => `record(await ready(0), yield* ${effect});`,
	},
];

export const all_statement_shapes: readonly StatementShape[] = statement_shapes;

const shapes_by_id = new Map(statement_shapes.map((shape) => [shape.id, shape]));

export function get_statement_shape(shape_id: string): StatementShape {
	const shape = shapes_by_id.get(shape_id);

	if (!shape) {
		throw new Error(`Unknown statement shape: ${shape_id}`);
	}

	return shape;
}

export function program_statement_kinds(spec: ScriptProgramSpec): StatementKind[] {
	return spec.statements.map((statement) => get_statement_shape(statement.shape_id).kind);
}

/**
 * Renders a program spec to source text.
 *
 * Imports and shadow declarations are filtered so the generated input never
 * declares the same top-level name twice. That keeps the duplicate-binding
 * oracle a statement about the transform rather than about the generator.
 */
export function render_script_program(spec: ScriptProgramSpec): string {
	const taken_names = new Set<string>();
	const import_lines: string[] = [];
	const shadow_lines: string[] = [];

	for (const text of spec.imports) {
		const entry = import_catalog.find((candidate) => candidate.text === text);

		if (!entry || entry.bindings.some((name) => taken_names.has(name))) {
			continue;
		}

		entry.bindings.forEach((name) => taken_names.add(name));
		import_lines.push(entry.text);
	}

	for (const name of spec.shadows) {
		if (taken_names.has(name)) {
			continue;
		}

		taken_names.add(name);
		shadow_lines.push(`const ${name} = 1;`);
	}

	const statement_lines = spec.statements.map((statement, index) => {
		const shape = get_statement_shape(statement.shape_id);

		return statement.trivia + shape.render(index, statement.effect);
	});

	/**
	 * A trailing import placed after effectful statements drives the transform's
	 * alternate injection branch, where the last import ends past the first
	 * lowered statement.
	 */
	const trailing_lines =
		spec.trailing_import && !taken_names.has("Trailing")
			? [`import { Trailing } from "./trailing.ts";`]
			: [];

	const body = [...import_lines, ...shadow_lines, ...statement_lines, ...trailing_lines].join(
		"\n",
	);

	/**
	 * A real `<script effect>` body is indented inside its tag and may use CRLF,
	 * so both shift every offset the transform computes.
	 */
	const indented = body
		.split("\n")
		.map((line) => (line === "" ? line : spec.indent + line))
		.join("\n");

	const terminated = spec.trailing_newline ? `${indented}\n` : indented;

	return spec.line_ending === "\n" ? terminated : terminated.replaceAll("\n", spec.line_ending);
}

export function make_statement_arbitrary(
	kinds: readonly StatementKind[],
): fc.Arbitrary<StatementSpec> {
	const allowed = statement_shapes.filter((shape) => kinds.includes(shape.kind));

	return fc.record({
		shape_id: fc.constantFrom(...allowed.map((shape) => shape.id)),
		effect: fc.constantFrom(...effect_expressions),
		trivia: fc.constantFrom(...trivia_options),
	});
}

/**
 * Builds an arbitrary over script programs restricted to the given statement
 * kinds.
 *
 * @param kinds - Statement kinds the generated programs may contain.
 * @param max_statements - Upper bound on generated statement count.
 */
export function make_script_program_arbitrary(
	kinds: readonly StatementKind[],
	max_statements = 8,
): fc.Arbitrary<ScriptProgramSpec> {
	return fc.record({
		imports: fc.uniqueArray(fc.constantFrom(...import_catalog.map((entry) => entry.text)), {
			maxLength: 4,
		}),
		shadows: fc.uniqueArray(fc.constantFrom(...shadow_catalog), { maxLength: 3 }),
		statements: fc.array(make_statement_arbitrary(kinds), {
			minLength: 1,
			maxLength: max_statements,
		}),
		trailing_import: fc.boolean(),
		indent: fc.constantFrom("", "\t", "  ", "\t\t"),
		line_ending: fc.constantFrom("\n", "\r\n"),
		trailing_newline: fc.boolean(),
	});
}
