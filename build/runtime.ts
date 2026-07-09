import { build } from "rolldown";
import { join, repo_root, reset_dir } from "./node-utils.ts";

const package_dir = join(repo_root, "modules", "svelte-effect-runtime");
const output_dir = join(repo_root, ".dist", "svelte-effect-runtime");
const src_dir = join(package_dir, "src");

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

await reset_dir(output_dir);

await build({
	input: {
		mod: join(src_dir, "mod.ts"),
		server: join(src_dir, "server.ts"),
		compiler: join(src_dir, "compiler.ts"),
		"runtime/transform": join(src_dir, "runtime", "transform.ts"),
		"internal/generators": join(src_dir, "internal", "generators.ts"),
		"internal/remote-client": join(src_dir, "internal", "remote-client.ts"),
		"internal/remote-server": join(src_dir, "internal", "remote-server.ts"),
		detect: join(src_dir, "detect.ts"),
		dispatcher: join(src_dir, "dispatcher.ts"),
		"remote/shared": join(src_dir, "remote", "shared.ts"),
		"remote/server": join(src_dir, "remote", "server.ts"),
		"remote/client": join(src_dir, "remote", "client.ts"),
		"markup/transform": join(src_dir, "markup", "transform.ts"),
		"markup/value": join(src_dir, "markup", "value.ts"),
		"markup/promise": join(src_dir, "markup", "promise.ts"),
		"markup/run": join(src_dir, "markup", "run.ts"),
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
					return join(src_dir, "mod.ts");
				}

				if (source.startsWith("$/")) {
					return join(src_dir, source.slice(2));
				}

				return null;
			},
		},
	],
	external,
});
