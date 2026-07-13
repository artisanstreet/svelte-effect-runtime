import { join, mkdir, repo_root } from "./node-utils.ts";
import { build } from "rolldown";

const package_dir = join(repo_root, "modules", "svelte-effect-runtime-language-server");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime-language-server");

await mkdir(output_dir, { recursive: true });

await build({
	input: join(package_dir, "src", "server.ts"),
	output: {
		file: join(output_dir, "server.cjs"),
		format: "cjs",
		sourcemap: true,
		banner: "#!/usr/bin/env node",
	},
	external: [
		/^node:/,
		/^magic-string$/,
		/^@jridgewell\/trace-mapping$/,
		/^svelte-language-server$/,
		/^vscode-languageserver(\/.*)?$/,
	],
});
