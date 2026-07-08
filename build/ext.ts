import { build } from "rolldown";
import { join, repo_root, reset_dir } from "./node-utils.ts";

const package_dir = join(repo_root, "modules", "svelte-effect-runtime-vsix");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime-vsix");

await reset_dir(output_dir);

await build({
	input: {
		extension: join(package_dir, "src", "extension.ts"),
	},
	output: {
		dir: output_dir,
		format: "cjs",
		entryFileNames: "[name].cjs",
		chunkFileNames: "chunks/[name]-[hash].js",
		sourcemap: true,
	},
	external: [
		/^node:/,
		/^vscode$/,
		/^magic-string$/,
		/^@jridgewell\/trace-mapping$/,
		/^svelte-language-server$/,
		/^vscode-languageserver(\/.*)?$/,
	],
});
