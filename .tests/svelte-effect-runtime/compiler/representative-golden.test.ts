import { transform_markup_effect } from "../../../modules/svelte-effect-runtime/src/markup/transform.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";
import { expect, test } from "vitest";

const fixture_root = fileURLToPath(new URL("./goldens/", import.meta.url));

test("representative markup transformation matches the complete reviewed golden", () => {
	const source = readFileSync(`${fixture_root}representative.input.svelte`, "utf8");
	const expected = readFileSync(`${fixture_root}representative.output.svelte`, "utf8");
	const result = transform_markup_effect(source, "Representative.svelte", {
		target: "client",
	});

	expect(result.code).toBe(expected);
	expect(() =>
		compile(result.code, {
			experimental: { async: true },
			generate: "client",
		}),
	).not.toThrow();
});
