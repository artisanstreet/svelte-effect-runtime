import { transform_svelte_effect } from "../../../modules/svelte-effect-runtime/src/runtime/transform.ts";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { expect, test } from "vitest";

function locate(content: string, text: string) {
	const offset = content.indexOf(text);
	const prefix = content.slice(0, offset);
	const lines = prefix.split("\n");

	expect(offset).toBeGreaterThanOrEqual(0);

	return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
}

test("maps unchanged declarations and markup after script lowering to authored positions", () => {
	const source = `<script lang="ts" effect>
import { Effect } from "effect";
const result = yield* Effect.succeed("hello");
const count: string = 123;
</script>
<p>{result} {count}</p>`;
	const result = transform_svelte_effect(source, "App.svelte");
	const trace = new TraceMap(result.map as ConstructorParameters<typeof TraceMap>[0]);

	for (const text of ["const count", "<p>", "Effect.succeed"]) {
		const actual = originalPositionFor(trace, locate(result.code, text));
		const expected = locate(source, text);

		expect(actual.line).toBe(expected.line);
		expect(actual.column).toBe(expected.column);
	}
});

test("maps relocated markup operands through both script and markup transforms", () => {
	const source = `<script lang="ts" effect>
import { Effect } from "effect";
const greeting = yield* Effect.succeed("hello");
</script>
<p>{yield* Effect.succeed(greeting.length)}</p>`;
	const result = transform_svelte_effect(source, "App.svelte");
	const trace = new TraceMap(result.map as ConstructorParameters<typeof TraceMap>[0]);
	const actual = originalPositionFor(trace, locate(result.code, "greeting.length"));
	const expected = locate(source, "greeting.length");

	expect(actual.line).toBe(expected.line);
	expect(actual.column).toBe(expected.column);
});
