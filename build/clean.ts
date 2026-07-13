import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { RemovePath, RepoRoot } from "./node-utils.ts";

type CleanTarget = {
	paths: ReadonlyArray<string>;
	files?: ReadonlyArray<{
		directory: string;
		extensions: ReadonlyArray<string>;
	}>;
};

const target_names = [
	"svelte-effect-runtime",
	"svelte-effect-runtime-grammars",
	"svelte-effect-runtime-language-server",
	"svelte-effect-runtime-vsix",
	"docs",
] as const;
const CleanTargetNameSchema = Schema.Literals(target_names);
const CleanTargetNamesSchema = Schema.Array(CleanTargetNameSchema);

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const clean_targets = yield* MakeCleanTargets(repo_root);
	const requested_targets = process.argv.length > 2 ? process.argv.slice(2) : target_names;
	const targets = yield* Schema.decodeUnknownEffect(CleanTargetNamesSchema)(requested_targets);
	const target_set = new Set(targets);

	for (const target of targets) {
		const config = clean_targets[target];

		for (const target_path of config.paths) {
			yield* RemovePath(target_path);
		}

		for (const file_config of config.files ?? []) {
			yield* RemoveMatchingFiles(file_config.directory, file_config.extensions);
		}
	}

	if (target_names.every((target) => target_set.has(target))) {
		yield* file_system.remove(path.join(repo_root, ".dist"), {
			force: true,
			recursive: true,
		});
		yield* file_system.remove(path.join(repo_root, ".tmp"), {
			force: true,
			recursive: true,
		});
	}
});

const MakeCleanTargets = (repo_root: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const clean_targets: Record<(typeof target_names)[number], CleanTarget> = {
			"svelte-effect-runtime": {
				paths: [
					path.join(repo_root, ".dist", "svelte-effect-runtime"),
					path.join(repo_root, "modules", "svelte-effect-runtime", ".dist"),
					path.join(repo_root, "modules", "svelte-effect-runtime", ".tmp"),
				],
				files: [
					{
						directory: path.join(repo_root, "modules", "svelte-effect-runtime"),
						extensions: [".tgz"],
					},
				],
			},
			"svelte-effect-runtime-grammars": {
				paths: [
					path.join(repo_root, ".dist", "svelte-effect-runtime-grammars"),
					path.join(repo_root, "modules", "svelte-effect-runtime-grammars", ".dist"),
				],
				files: [
					{
						directory: path.join(
							repo_root,
							"modules",
							"svelte-effect-runtime-grammars",
						),
						extensions: [".tgz"],
					},
				],
			},
			"svelte-effect-runtime-language-server": {
				paths: [
					path.join(repo_root, ".dist", "svelte-effect-runtime-language-server"),
					path.join(
						repo_root,
						"modules",
						"svelte-effect-runtime-language-server",
						".dist",
					),
					path.join(
						repo_root,
						"modules",
						"svelte-effect-runtime-language-server",
						".tmp",
					),
					path.join(
						repo_root,
						"modules",
						"svelte-effect-runtime-language-server",
						"runtime",
					),
				],
				files: [
					{
						directory: path.join(
							repo_root,
							"modules",
							"svelte-effect-runtime-language-server",
						),
						extensions: [".tgz"],
					},
				],
			},
			"svelte-effect-runtime-vsix": {
				paths: [
					path.join(repo_root, ".dist", "svelte-effect-runtime-vsix"),
					path.join(repo_root, "modules", "svelte-effect-runtime-vsix", ".dist"),
					path.join(repo_root, "modules", "svelte-effect-runtime-vsix", "runtime"),
				],
				files: [
					{
						directory: path.join(repo_root, "modules", "svelte-effect-runtime-vsix"),
						extensions: [".vsix"],
					},
				],
			},
			docs: {
				paths: [
					path.join(repo_root, "modules", "docs", ".next"),
					path.join(repo_root, "modules", "docs", ".source"),
					path.join(repo_root, "modules", "docs", ".vercel"),
					path.join(repo_root, "modules", "docs", "next-env.d.ts"),
				],
			},
		};

		return clean_targets;
	});

const RemoveMatchingFiles = (directory: string, extensions: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const entries = yield* file_system
			.readDirectory(directory)
			.pipe(
				Effect.catch((error) =>
					is_not_found_error(error) ? Effect.succeed([]) : Effect.fail(error),
				),
			);

		for (const entry of entries) {
			if (!extensions.some((extension) => entry.endsWith(extension))) {
				continue;
			}

			const entry_path = path.join(directory, entry);
			const info = yield* file_system.stat(entry_path);

			if (info.type !== "File") {
				continue;
			}

			yield* file_system.remove(entry_path, { force: true });
		}
	});

function is_not_found_error(error: PlatformError.PlatformError): boolean {
	return error.reason._tag === "NotFound";
}

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
