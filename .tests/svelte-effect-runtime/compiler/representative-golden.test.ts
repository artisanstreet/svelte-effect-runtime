import { transform_svelte_effect } from "svelte-effect-runtime/runtime/transform";
import { rewrite_remote_client_exports } from "svelte-effect-runtime/compiler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";
import { expect, test } from "vitest";

import ts from "typescript";

const fixture_root = fileURLToPath(new URL("./goldens/", import.meta.url));

function normalize_line_endings(source: string): string {
	return source.replaceAll("\r\n", "\n");
}

test("the complete representative component transform matches its reviewed golden", () => {
	const source = normalize_line_endings(
		readFileSync(`${fixture_root}representative.input.svelte.txt`, "utf8"),
	);
	const expected = normalize_line_endings(
		readFileSync(`${fixture_root}representative.output.svelte.txt`, "utf8"),
	);
	const result = transform_svelte_effect(source, "Representative.svelte", {
		target: "client",
	});

	expect(result.code).toBe(expected);
});

test("representative generated components compile for browser and server", () => {
	const source = normalize_line_endings(
		readFileSync(`${fixture_root}representative.input.svelte.txt`, "utf8"),
	);
	const client = transform_svelte_effect(source, "Representative.svelte", {
		target: "client",
	});
	const server = transform_svelte_effect(source, "Representative.svelte", {
		target: "server",
	});

	expect(() =>
		compile(client.code, {
			experimental: { async: true },
			filename: "Representative.svelte",
			generate: "client",
		}),
	).not.toThrow();
	expect(() =>
		compile(server.code, {
			experimental: { async: true },
			filename: "Representative.svelte",
			generate: "server",
		}),
	).not.toThrow();
});

test("the complete generated remote module matches its reviewed golden and parses", async () => {
	const source = normalize_line_endings(
		readFileSync(`${fixture_root}remote-module.input.ts.txt`, "utf8"),
	);
	const expected = normalize_line_endings(
		readFileSync(`${fixture_root}remote-module.output.ts.txt`, "utf8"),
	);
	const result = await rewrite_remote_client_exports(source);
	const transpiled = ts.transpileModule(result, {
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ESNext,
		},
		fileName: "generated.remote.ts",
		reportDiagnostics: true,
	});

	expect(result).toBe(expected);
	expect(transpiled.diagnostics ?? []).toEqual([]);
});
