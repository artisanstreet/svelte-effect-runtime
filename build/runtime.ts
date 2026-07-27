import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RepoRoot, ResetDir } from "./node-utils.ts";
import { Effect, Path } from "effect";
import { build } from "rolldown";

const external = [
	/^node:/,
	/^effect(?:\/.*)?$/,
	/^svelte(?:\/.*)?$/,
	/^vite$/,
	/^@sveltejs\/vite-plugin-svelte$/,
	/^@sveltejs\/kit(?:\/.*)?$/,
	/^\$app\//,
	/^typescript$/,
	/^magic-string$/,
	/^devalue$/,
	/^@babel\/parser$/,
];

const Main = Effect.gen(function* () {
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const package_dir = path.join(repo_root, "modules", "svelte-effect-runtime");
	const output_dir = path.join(repo_root, ".dist", "svelte-effect-runtime");
	const src_dir = path.join(package_dir, "src");

	yield* ResetDir(output_dir);
	yield* Effect.tryPromise(() =>
		build({
			input: {
				mod: path.join(src_dir, "mod.ts"),
				server: path.join(src_dir, "server.ts"),
				compiler: path.join(src_dir, "compiler.ts"),
				environment: path.join(src_dir, "environment.ts"),
				"runtime/transform": path.join(src_dir, "runtime", "transform.ts"),
				"internal/generators": path.join(src_dir, "internal", "generators.ts"),
				"internal/remote-client": path.join(src_dir, "internal", "remote-client.ts"),
				"internal/remote-server": path.join(src_dir, "internal", "remote-server.ts"),
				detect: path.join(src_dir, "detect.ts"),
				dispatcher: path.join(src_dir, "dispatcher.ts"),
				"remote/shared": path.join(src_dir, "remote", "shared.ts"),
				"remote/server": path.join(src_dir, "remote", "server.ts"),
				"remote/client": path.join(src_dir, "remote", "client.ts"),
				"markup/transform": path.join(src_dir, "markup", "transform.ts"),
				"markup/value": path.join(src_dir, "markup", "value.ts"),
				"markup/promise": path.join(src_dir, "markup", "promise.ts"),
				"markup/run": path.join(src_dir, "markup", "run.ts"),
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
					name: "runtime-aliases",
					resolveId(source) {
						if (source === "$") {
							return path.join(src_dir, "mod.ts");
						}

						if (source.startsWith("$/")) {
							return path.join(src_dir, source.slice(2));
						}

						return null;
					},
				},
			],
			external,
		}),
	);
});

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
