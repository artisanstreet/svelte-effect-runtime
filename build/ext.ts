import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RepoRoot, ResetDir } from "./node-utils.ts";
import { Effect, Path } from "effect";
import { build } from "rolldown";

const Main = Effect.gen(function* () {
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const package_dir = path.join(repo_root, "modules", "svelte-effect-runtime-vsix");
	const output_dir = path.join(repo_root, ".dist", "svelte-effect-runtime-vsix");

	yield* ResetDir(output_dir);
	yield* Effect.tryPromise(() =>
		build({
			input: {
				extension: path.join(package_dir, "src", "extension.ts"),
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
		}),
	);
});

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
