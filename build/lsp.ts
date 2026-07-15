import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { RepoRoot } from "./node-utils.ts";
import { build } from "rolldown";

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const package_dir = path.join(repo_root, "modules", "svelte-effect-runtime-language-server");
	const output_dir = path.join(repo_root, ".dist", "svelte-effect-runtime-language-server");

	yield* file_system.makeDirectory(output_dir, { recursive: true });
	yield* Effect.tryPromise(() =>
		build({
			input: path.join(package_dir, "src", "server.ts"),
			output: {
				file: path.join(output_dir, "server.cjs"),
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
		}),
	);
});

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
