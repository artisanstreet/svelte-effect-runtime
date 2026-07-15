import { readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type SourcePipelineMode = "auto" | "off" | "ser";

type SvelteEffectTransform = {
	transform_svelte_effect: (
		code: string,
		filename: string,
		options: { readonly target: "client" },
	) => { readonly code: string };
};

const script_effect_pattern = /<script\b[^>]*\beffect(?:\s|=|>)/;
const yield_first_markup_pattern = /[{=]\s*yield\*/;

const workspace = process.cwd();
const source_pipeline = parse_source_pipeline(process.argv.slice(2));
const source_root = join(workspace, "src");
const source_files = await collect_svelte_files(source_root);
const originals = new Map<string, string>();

try {
	if (source_pipeline !== "off") {
		const transform = await load_svelte_effect_transform(workspace);

		for (const source_file of source_files) {
			const source = await readFile(source_file, "utf8");
			const should_transform =
				source_pipeline === "ser" ||
				script_effect_pattern.test(source) ||
				yield_first_markup_pattern.test(source);

			if (!should_transform) {
				continue;
			}

			const transformed = transform.transform_svelte_effect(source, source_file, {
				target: "client",
			});

			originals.set(source_file, source);
			await writeFile(source_file, transformed.code);
		}
	}

	process.exitCode = run_svelte_check(workspace);
} finally {
	await Promise.all(
		[...originals].map(([source_file, source]) => writeFile(source_file, source)),
	);
}

function parse_source_pipeline(arguments_: ReadonlyArray<string>): SourcePipelineMode {
	const option_index = arguments_.indexOf("--source-pipeline");
	const value = option_index === -1 ? "auto" : arguments_[option_index + 1];

	if (value === "auto" || value === "off" || value === "ser") {
		return value;
	}

	throw new Error(`Invalid --source-pipeline value: ${value ?? "missing"}.`);
}

async function collect_svelte_files(root: string): Promise<readonly string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const path = join(root, entry.name);

			if (entry.isDirectory()) {
				return collect_svelte_files(path);
			}

			return Promise.resolve(entry.isFile() && entry.name.endsWith(".svelte") ? [path] : []);
		}),
	);

	return files.flat();
}

async function load_svelte_effect_transform(
	workspace_path: string,
): Promise<SvelteEffectTransform> {
	const require_from_workspace = createRequire(join(workspace_path, "package.json"));
	const transform_path = require_from_workspace.resolve(
		"svelte-effect-runtime/runtime/transform",
	);
	const transform_module: unknown = await import(pathToFileURL(transform_path).href);

	if (!transform_module || typeof transform_module !== "object") {
		throw new Error(`Invalid SER transform module at ${transform_path}.`);
	}

	const transform = Reflect.get(transform_module, "transform_svelte_effect");

	if (typeof transform !== "function") {
		throw new Error(
			`SER transform module ${transform_path} has no transform_svelte_effect export.`,
		);
	}

	return {
		transform_svelte_effect(code, filename, options) {
			const result: unknown = Reflect.apply(transform, transform_module, [
				code,
				filename,
				options,
			]);

			if (!result || typeof result !== "object") {
				throw new Error(`SER transform ${transform_path} returned a non-object result.`);
			}

			const transformed_code = Reflect.get(result, "code");

			if (typeof transformed_code !== "string") {
				throw new Error(`SER transform ${transform_path} returned no string code.`);
			}

			return { code: transformed_code };
		},
	};
}

function run_svelte_check(workspace_path: string): number {
	const uses_windows_corepack = process.platform === "win32";
	const command = uses_windows_corepack ? process.execPath : "corepack";
	const arguments_ = uses_windows_corepack
		? [
				join(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js"),
				"pnpm",
				"exec",
				"svelte-check",
				"--tsconfig",
				"./tsconfig.json",
				"--threshold",
				"error",
			]
		: ["pnpm", "exec", "svelte-check", "--tsconfig", "./tsconfig.json", "--threshold", "error"];
	const result = spawnSync(command, arguments_, {
		cwd: workspace_path,
		env: process.env,
		stdio: "inherit",
		windowsHide: true,
	});

	if (result.error) {
		throw result.error;
	}

	return result.status ?? 1;
}
