import { scan_svelte_effect_source } from "../../../modules/svelte-effect-runtime/src/compiler/source-scan.ts";
import { assert_equals } from "../unit/helpers/assert.ts";
import { test, vi } from "vitest";

vi.mock("svelte/compiler", async (import_original) => {
	const compiler = await import_original<typeof import("svelte/compiler")>();

	return {
		...compiler,
		parse(...args: Parameters<typeof compiler.parse>): ReturnType<typeof compiler.parse> {
			const ast = compiler.parse(...args);

			Reflect.deleteProperty(ast, "comments");

			return ast;
		},
	};
});

test("scans parser-owned markup when the Svelte root omits comments", () => {
	const source = `<Component><p>{yield* load()}</p></Component>`;
	const scan = scan_svelte_effect_source(source, "LegacyRoot.svelte");

	assert_equals(
		scan.markup_expressions.map(({ expression_text }) => expression_text),
		["yield* load()"],
	);
});
