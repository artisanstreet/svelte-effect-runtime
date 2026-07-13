import { cp, join, readFile, repo_root, reset_dir, writeFile } from "./node-utils.ts";
import { generate_tree_sitter_query_module } from "./grammar-query-codegen.ts";
import { build } from "rolldown";

const package_dir = join(repo_root, "modules", "svelte-effect-runtime-grammars");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime-grammars");
const src_dir = join(package_dir, "src");
const highlights_query_path = join(src_dir, "tree-sitter", "highlights.tsq");
const injections_query_path = join(src_dir, "tree-sitter", "injections.tsq");
const generated_query_module_path = join(src_dir, "tree-sitter", "queries.generated.ts");

const highlights_query = normalize_line_endings(await readFile(highlights_query_path, "utf8"));
const injections_query = normalize_line_endings(await readFile(injections_query_path, "utf8"));

await reset_dir(output_dir);
await writeFile(
	generated_query_module_path,
	generate_tree_sitter_query_module(highlights_query, injections_query),
);

await build({
	input: {
		mod: join(src_dir, "mod.ts"),
		textmate: join(src_dir, "textmate.ts"),
		"tree-sitter": join(src_dir, "tree-sitter.ts"),
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
			async load(id) {
				if (!id.endsWith(".tsq")) {
					return null;
				}

				const content = await readFile(id, "utf8");

				return {
					code: `export default ${JSON.stringify(content)};`,
					moduleType: "js",
				};
			},
		},
	],
});

await cp(join(src_dir, "textmate"), join(output_dir, "textmate"), {
	force: true,
	recursive: true,
});
await cp(join(src_dir, "tree-sitter"), join(output_dir, "tree-sitter"), {
	force: true,
	recursive: true,
});

function normalize_line_endings(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
