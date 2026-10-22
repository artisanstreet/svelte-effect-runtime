import { ensure_packed_artifact } from "../svelte-effect-runtime/public-api/packed-artifact.ts";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repo_root = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(repo_root, ".dist", "better-svelte-check", "cli.js");
let fixture_root: string;

interface CheckResult {
	errors: number;
	warnings: number;
	files: Array<{
		filePath: string;
		text: string;
		diagnostics: Array<{
			message: string;
			code: number | string;
			range: {
				start: { line: number; character: number };
				end: { line: number; character: number };
			};
		}>;
	}>;
}

beforeAll(async () => {
	await ensure_packed_artifact();
	const build = spawnSync("corepack", ["pnpm", "run", "build:checker"], {
		cwd: repo_root,
		encoding: "utf8",
		timeout: 30_000,
	});

	expect(build.status, build.stdout + build.stderr).toBe(0);

	fixture_root = await mkdtemp(join(tmpdir(), "better-svelte-check-"));

	await mkdir(join(fixture_root, "node_modules", "@sveltejs"), { recursive: true });

	for (const name of [
		"effect",
		"svelte",
		"typescript",
		"vite",
		"@sveltejs/kit",
		"@sveltejs/vite-plugin-svelte",
	]) {
		await symlink(
			join(repo_root, "node_modules", name),
			join(fixture_root, "node_modules", name),
		);
	}

	const runtime_root = join(fixture_root, "node_modules", "svelte-effect-runtime");

	await mkdir(runtime_root);
	await cp(join(repo_root, ".dist", "svelte-effect-runtime"), join(runtime_root, ".dist"), {
		recursive: true,
	});
	await cp(
		join(repo_root, "modules", "svelte-effect-runtime", "package.json"),
		join(runtime_root, "package.json"),
	);
	await symlink(
		join(repo_root, "modules", "svelte-effect-runtime", "node_modules"),
		join(runtime_root, "node_modules"),
	);
}, 180_000);

afterAll(async () => {
	if (fixture_root) {
		await rm(fixture_root, { recursive: true, force: true });
	}
});

async function make_project(name: string, source: string, extra_plugin = "", preprocessing = "") {
	const workspace = join(fixture_root, name);
	const source_path = join(workspace, "src", "App.svelte");

	await mkdir(join(workspace, "src"), { recursive: true });
	await writeFile(join(workspace, "package.json"), JSON.stringify({ type: "module" }));
	await writeFile(
		join(workspace, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				ignoreDeprecations: "6.0",
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				skipLibCheck: true,
				types: ["svelte", "vite/client"],
			},
			include: ["src/**/*"],
		}),
	);
	await writeFile(
		join(workspace, "vite.config.ts"),
		`
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { effect } from "svelte-effect-runtime/compiler";
export default {
	plugins: [${extra_plugin} ...effect(), svelte({ configFile: false, ${preprocessing} compilerOptions: { experimental: { async: true } } })]
};
`,
	);
	await writeFile(source_path, source);

	return { workspace, source_path };
}

function run_check(workspace: string) {
	const result = spawnSync(
		process.execPath,
		[cli, "--workspace", workspace, "--output", "json"],
		{ encoding: "utf8", timeout: 30_000 },
	);

	expect(result.error).toBeUndefined();

	return {
		...result,
		parsed: result.stdout.trim().startsWith("{")
			? (JSON.parse(result.stdout) as CheckResult)
			: undefined,
	};
}

test("checks script, markup, and yield-first events without modifying authored files", async () => {
	const source = `<script lang="ts" effect>
import { Effect } from "effect";
const value = yield* Effect.succeed("hello");
</script>
<svelte:boundary>
<p>{value}</p>
<p>{yield* Effect.succeed("markup")}</p>
<button onclick={yield* Effect.void}>Save</button>
</svelte:boundary>`;
	const { workspace, source_path } = await make_project("valid-ser", source);
	const result = run_check(workspace);

	expect(result.stderr).toBe("");
	expect(result.parsed, result.stdout).toBeDefined();
	expect(result.parsed?.errors, result.stdout).toBe(0);
	expect(result.status).toBe(0);
	expect(await readFile(source_path, "utf8")).toBe(source);
});

test("preserves annotations with Vite TypeScript preprocessing and maps an error after lowering", async () => {
	const source = `<script lang="ts" effect>
import { Effect } from "effect";
const value = yield* Effect.succeed("hello");
const count: string = 123;
</script>
<p>{value} {count}</p>`;
	const { workspace, source_path } = await make_project(
		"typed-ser",
		source,
		"",
		"preprocess: vitePreprocess({ script: true }),",
	);
	const result = run_check(workspace);
	const diagnostic = result.parsed?.files
		.flatMap((file) => file.diagnostics)
		.find((item) => item.code === 2322);

	expect(result.status, result.stdout + result.stderr).toBe(1);
	expect(diagnostic, result.stdout).toBeDefined();
	expect(diagnostic?.range.start.line).toBe(3);
	expect(result.parsed?.files.find((file) => file.filePath === source_path)?.text).toBe(source);
	expect(await readFile(source_path, "utf8")).toBe(source);
});

test("runs a configured Vite transform before checking", async () => {
	const source = `<script lang="ts">const value: string = CHECKER_REPLACE;</script><p>{value}</p>`;
	const extra_plugin = `{ name: "fixture-source", enforce: "pre", transform(code, id) {
	if (!id.endsWith(".svelte")) return;
	return { code: code.replace("CHECKER_REPLACE", "123"), map: null };
} },`;
	const { workspace } = await make_project("vite-transform", source, extra_plugin);
	const result = run_check(workspace);

	expect(result.status, result.stdout + result.stderr).toBe(1);
	expect(
		result.parsed?.files.flatMap((file) => file.diagnostics).some((item) => item.code === 2322),
	).toBe(true);
	expect(result.stdout).not.toContain("Cannot find name 'CHECKER_REPLACE'");
});

test("checks imported SER components outside the initial project crawl", async () => {
	const { workspace } = await make_project(
		"external-import",
		`<script lang="ts">import External from "../../external/External.svelte";</script><External />`,
	);
	const external_path = join(fixture_root, "external", "External.svelte");
	const external_source = `<script lang="ts" effect>
import { Effect } from "effect";
const value = yield* Effect.succeed("hello");
const count: string = 123;
</script><p>{value} {count}</p>`;

	await mkdir(join(fixture_root, "external"), { recursive: true });
	await writeFile(external_path, external_source);

	const result = run_check(workspace);
	const diagnostics = result.parsed?.files.find(
		(file) => file.filePath === external_path,
	)?.diagnostics;

	expect(result.status, result.stdout + result.stderr).toBe(1);
	expect(diagnostics, result.stdout).toBeDefined();
	expect(diagnostics?.some((item) => item.code === 2322)).toBe(true);
	expect(result.stdout).not.toContain("keyword 'yield'");
	expect(await readFile(external_path, "utf8")).toBe(external_source);
});

test("exits after checking when a project plugin retains a background handle", async () => {
	const { workspace } = await make_project(
		"plugin-background-handle",
		"<p>hello</p>",
		`{name: "fixture-background", configureServer() {setInterval(() => {}, 1000);}},`,
	);
	const result = run_check(workspace);

	expect(result.status, result.stdout + result.stderr).toBe(0);
	expect(result.parsed?.errors).toBe(0);
});

test("surfaces Vite transform failures and returns a nonzero exit code", async () => {
	const { workspace } = await make_project(
		"plugin-error",
		"<p>hello</p>",
		`{name: "fixture-failure", enforce: "pre", transform() {throw new Error("fixture transform failed");}},`,
	);
	const result = run_check(workspace);

	expect(result.status).toBe(1);
	expect(result.stdout + result.stderr).toContain("fixture transform failed");
});

test("checks a native Svelte project without SER", async () => {
	const { workspace } = await make_project(
		"native-svelte",
		'<script lang="ts">const value = 123;</script><p>{value}</p>',
	);
	const config_path = join(workspace, "vite.config.ts");
	const config = await readFile(config_path, "utf8");

	await writeFile(config_path, config.replace("...effect(),", ""));

	const result = run_check(workspace);

	expect(result.status, result.stdout + result.stderr).toBe(0);
	expect(result.parsed?.errors).toBe(0);
});

test("loads ambient helpers for component props, snippets, and spreads", async () => {
	const { workspace } = await make_project(
		"ambient-helpers",
		`<script lang="ts">import Child from "./Child.svelte";</script>
<Child label="hello">{#snippet children()}<p>content</p>{/snippet}</Child>`,
	);

	await writeFile(
		join(workspace, "src", "Child.svelte"),
		`<script lang="ts">
import type { Snippet } from "svelte";
const { label, children, ...rest }: {label: string; children: Snippet} = $props();
</script><div {...rest}>{label}{@render children()}</div>`,
	);

	const result = run_check(workspace);

	expect(result.status, result.stdout + result.stderr).toBe(0);
	expect(result.parsed?.errors).toBe(0);
});

test("leaves excluded components outside the processing pipeline", async () => {
	const { workspace } = await make_project("excluded-source", "<p>hello</p>");

	await writeFile(
		join(workspace, "Excluded.svelte"),
		"<script effect>const invalid = yield* ;</script>",
	);

	const result = run_check(workspace);

	expect(result.status, result.stdout + result.stderr).toBe(0);
});

test("maps errors in yielded bindings and relocated markup operands", async () => {
	const source = `<script lang="ts" effect>
import { Effect } from "effect";
const result: string = yield* Effect.succeed(42);
</script>
<svelte:boundary>
<p>{yield* Effect.succeed(result.no_property)}</p>
</svelte:boundary>`;
	const { workspace } = await make_project("relocated-errors", source);
	const result = run_check(workspace);
	const diagnostics = result.parsed?.files.flatMap((file) => file.diagnostics);

	expect(result.status, result.stdout + result.stderr).toBe(1);
	expect(diagnostics?.find((item) => item.code === 2322)?.range.start.line).toBe(2);
	expect(diagnostics?.find((item) => item.code === 2339)?.range.start.line).toBe(5);
});

test("uses SvelteKit compiler options from Vite without a separate Svelte config", async () => {
	const source = `<script lang="ts" effect>
import { Effect } from "effect";
const value = yield* Effect.succeed("hello");
</script><p>{value}</p>`;
	const { workspace } = await make_project("sveltekit-project", source);

	await writeFile(
		join(workspace, "src", "app.html"),
		"<!doctype html><html><head>%sveltekit.head%</head><body><div>%sveltekit.body%</div></body></html>",
	);
	await writeFile(
		join(workspace, "vite.config.ts"),
		`
import { sveltekit } from "@sveltejs/kit/vite";
import { effect } from "svelte-effect-runtime/compiler";
export default { plugins: [...effect(), sveltekit({compilerOptions: {experimental: {async: true}}})] };
`,
	);

	const result = run_check(workspace);

	expect(result.status, result.stdout + result.stderr).toBe(0);
	expect(result.parsed?.errors).toBe(0);
});

test("rejects script preprocessors whose type preservation is unknown", async () => {
	const { workspace } = await make_project(
		"unsupported-preprocess",
		"<p>hello</p>",
		"",
		"preprocess: {name: 'unknown-script', script: ({content}) => ({code: content})},",
	);
	const result = run_check(workspace);

	expect(result.status).toBe(1);
	expect(result.stdout + result.stderr).toContain(
		"Unsupported script preprocessor: unknown-script",
	);
});

test("rejects unsupported CLI flags rather than silently ignoring them", () => {
	const result = spawnSync(process.execPath, [cli, "--watch"], { encoding: "utf8" });

	expect(result.status).toBe(1);
	expect(result.stdout + result.stderr).toContain("Unsupported or incomplete argument: --watch");
});
