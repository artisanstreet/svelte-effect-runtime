import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RepoRoot, ResetDir } from "./node-utils.ts";
import { Effect, FileSystem, Path } from "effect";
import { build } from "rolldown";

const Main = Effect.gen(function* () {
	const path = yield* Path.Path;
	const file_system = yield* FileSystem.FileSystem;
	const root = yield* RepoRoot;
	const output = path.join(root, ".dist", "better-svelte-check");

	yield* ResetDir(output);
	yield* Effect.tryPromise(() =>
		build({
			input: path.join(root, "modules", "better-svelte-check", "src", "cli.ts"),
			output: { file: path.join(output, "cli.js"), format: "esm", sourcemap: true },
			external: [
				/^node:/,
				/^typescript$/,
				/^effect(?:\/.*)?$/,
				/^@effect\//,
				/^@jridgewell\//,
				/^svelte-language-server(?:\/.*)?$/,
			],
		}),
	);
	yield* file_system.symlink(
		path.join(root, "modules", "better-svelte-check", "node_modules"),
		path.join(output, "node_modules"),
	);
});

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
