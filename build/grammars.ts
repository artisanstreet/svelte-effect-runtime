import { generate_tree_sitter_query_module } from "./grammar-query-codegen.ts";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RepoRoot, ResetDir } from "./node-utils.ts";
import { Effect, FileSystem, Path } from "effect";
import { build } from "rolldown";

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const package_dir = path.join(repo_root, "modules", "svelte-effect-runtime-grammars");
	const output_dir = path.join(repo_root, ".dist", "svelte-effect-runtime-grammars");
	const src_dir = path.join(package_dir, "src");
	const highlights_query_path = path.join(src_dir, "tree-sitter", "highlights.tsq");
	const injections_query_path = path.join(src_dir, "tree-sitter", "injections.tsq");
	const generated_query_module_path = path.join(src_dir, "tree-sitter", "queries.generated.ts");
	const highlights_query = normalize_line_endings(
		yield* file_system.readFileString(highlights_query_path),
	);
	const injections_query = normalize_line_endings(
		yield* file_system.readFileString(injections_query_path),
	);
	const query_assets = new Map([
		[highlights_query_path.replaceAll("\\", "/"), highlights_query],
		[injections_query_path.replaceAll("\\", "/"), injections_query],
	]);

	yield* ResetDir(output_dir);
	yield* file_system.writeFileString(
		generated_query_module_path,
		generate_tree_sitter_query_module(highlights_query, injections_query),
	);
	yield* Effect.tryPromise(() =>
		build({
			input: {
				mod: path.join(src_dir, "mod.ts"),
				textmate: path.join(src_dir, "textmate.ts"),
				"tree-sitter": path.join(src_dir, "tree-sitter.ts"),
			},
			output: {
				dir: output_dir,
				format: "esm",
				entryFileNames: "[name].js",
				chunkFileNames: "chunks/[name]-[hash].js",
				sourcemap: true,
			},
			plugins: [
				{
					name: "grammar-text-assets",
					load(id) {
						const content = query_assets.get(id.replaceAll("\\", "/"));

						if (content === undefined) {
							return null;
						}

						return {
							code: `export default ${JSON.stringify(content)};`,
							moduleType: "js",
						};
					},
				},
			],
		}),
	);
	yield* file_system.copy(path.join(src_dir, "textmate"), path.join(output_dir, "textmate"), {
		overwrite: true,
	});
	yield* file_system.copy(
		path.join(src_dir, "tree-sitter"),
		path.join(output_dir, "tree-sitter"),
		{ overwrite: true },
	);
});

function normalize_line_endings(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
