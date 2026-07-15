import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema } from "effect";
import { RepoRoot } from "./node-utils.ts";

const RuntimeManifestSchema = Schema.Struct({
	dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
	peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const AssetTargetSchema = Schema.Literals(["svelte-effect-runtime-language-server"] as const);

const runtime_directories = ["chunks", "internal", "markup", "remote", "runtime"];

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const target = yield* Schema.decodeUnknownEffect(AssetTargetSchema)(process.argv[2]);
	const runtime_dist = path.join(repo_root, ".dist", "svelte-effect-runtime");
	const runtime_manifest_path = path.join(
		repo_root,
		"modules",
		"svelte-effect-runtime",
		"package.json",
	);
	const target_dist_dir = path.join(repo_root, ".dist", target);
	const runtime_dir = path.join(target_dist_dir, "runtime");
	const has_runtime_dist = yield* file_system.exists(runtime_dist);

	if (!has_runtime_dist) {
		return yield* Effect.fail(new Error(`Runtime .dist not found at ${runtime_dist}`));
	}

	yield* file_system.makeDirectory(target_dist_dir, { recursive: true });
	yield* file_system.remove(runtime_dir, { force: true, recursive: true });
	yield* file_system.makeDirectory(runtime_dir, { recursive: true });

	const runtime_manifest_text = yield* file_system.readFileString(runtime_manifest_path);
	const runtime_manifest_json = yield* Schema.decodeUnknownEffect(
		Schema.fromJsonString(Schema.Unknown),
	)(runtime_manifest_text);
	const runtime_manifest =
		yield* Schema.decodeUnknownEffect(RuntimeManifestSchema)(runtime_manifest_json);
	const runtime_package_json = {
		type: "module",
		dependencies: {
			svelte: runtime_manifest.peerDependencies?.svelte,
			typescript: runtime_manifest.dependencies?.typescript,
		},
	};

	yield* file_system.writeFileString(
		path.join(runtime_dir, "package.json"),
		`${JSON.stringify(runtime_package_json, null, 2)}\n`,
	);

	const runtime_root_files = yield* file_system.readDirectory(runtime_dist);

	for (const filename of runtime_root_files) {
		if (!is_runtime_asset_file(filename)) {
			continue;
		}

		const source_path = path.join(runtime_dist, filename);
		const info = yield* file_system.stat(source_path);

		if (info.type !== "File") {
			continue;
		}

		yield* file_system.copyFile(source_path, path.join(runtime_dir, filename));
	}

	for (const directory of runtime_directories) {
		const source_dir = path.join(runtime_dist, directory);
		const target_dir = path.join(runtime_dir, directory);
		const has_source_dir = yield* file_system.exists(source_dir);

		if (!has_source_dir) {
			continue;
		}

		yield* file_system.makeDirectory(target_dir, { recursive: true });
		yield* file_system.copy(source_dir, target_dir, { overwrite: true });
	}

	yield* file_system.writeFileString(
		path.join(runtime_dir, "transform.js"),
		`export * from "./runtime/transform.js";\n`,
	);
	yield* file_system.writeFileString(
		path.join(runtime_dir, "transform.d.ts"),
		`export * from "./runtime/transform";\n`,
	);
});

function is_runtime_asset_file(filename: string): boolean {
	return filename.endsWith(".js") || filename.endsWith(".js.map") || filename.endsWith(".d.ts");
}

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
