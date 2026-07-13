import { Console, Effect, FileSystem, Path, PlatformError, Schema } from "effect";
import { CommandName, RepoRoot, RemovePath, RunCommand } from "./node-utils.ts";
import { NodeRuntime, NodeServices } from "@effect/platform-node";

type PackageContext = {
	package_dir: string;
	output_dir: string;
	staging_dir: string;
	staging_dist_dir: string;
	package_manifest_path: string;
};

const dependency_fields = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

const PackageManifestSchema = Schema.Record(Schema.String, Schema.Unknown);
const WorkspaceManifestSchema = Schema.Struct({ version: Schema.String });
const ManifestSideFilesSchema = Schema.Array(
	Schema.String.pipe(
		Schema.check(
			Schema.isPattern(
				/^(?![A-Za-z]:)(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*(?:\*|\?|\[|\]|\{|\}|!))[^\\]+$/,
			),
		),
	),
);
const PackTargetSchema = Schema.Literals([
	"svelte-effect-runtime",
	"svelte-effect-runtime-grammars",
	"svelte-effect-runtime-language-server",
] as const);

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const repo_root = yield* RepoRoot;
	const package_name = yield* Schema.decodeUnknownEffect(PackTargetSchema)(process.argv[2]);
	const package_dir = path.join(repo_root, "modules", package_name);
	const output_dir = path.join(repo_root, ".dist", package_name);
	const staging_dir = path.join(repo_root, ".tmp", "pack", package_name);
	const context: PackageContext = {
		package_dir,
		output_dir,
		staging_dir,
		staging_dist_dir: path.join(staging_dir, ".dist"),
		package_manifest_path: path.join(package_dir, "package.json"),
	};
	const has_output = yield* file_system.exists(output_dir);

	if (!has_output) {
		return yield* Effect.fail(new Error(`Package build output not found at ${output_dir}`));
	}

	const Package = Effect.gen(function* () {
		yield* RemovePath(staging_dir);
		yield* file_system.makeDirectory(staging_dir, { recursive: true });
		yield* CopyPackageOutput(context);
		yield* CopyPackageManifest(context, repo_root);
		yield* CopyStandardFiles(context, repo_root);
		yield* CopyManifestFiles(context);

		const command = yield* CommandName("corepack");
		const pack_output = yield* RunCommand(
			command,
			["pnpm", "pack", "--pack-destination", output_dir, "--json"],
			staging_dir,
		);

		yield* Console.log(pack_output.stdout.trim());
	});

	yield* Package.pipe(Effect.ensuring(RemovePath(staging_dir).pipe(Effect.orDie)));
});

function CopyPackageOutput(context: PackageContext) {
	return Effect.gen(function* () {
		const manifest = yield* ReadPackageManifest(context.package_manifest_path);
		const side_files = yield* GetManifestSideFiles(manifest);

		yield* CopyDirectoryFiltered(
			context.output_dir,
			context.staging_dist_dir,
			(relative_path) => {
				const is_artifact =
					relative_path.endsWith(".tgz") || relative_path.endsWith(".vsix");
				const is_side_file = side_files.some(
					(file) => relative_path === file || relative_path.startsWith(`${file}/`),
				);

				return !is_artifact && !is_side_file;
			},
		);
	});
}

function CopyDirectoryFiltered(
	source_dir: string,
	target_dir: string,
	include: (relative_path: string) => boolean,
) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		yield* file_system.makeDirectory(target_dir, { recursive: true });

		const entries = yield* file_system.readDirectory(source_dir, { recursive: true });

		for (const relative_path of entries) {
			const normalized_path = relative_path.replaceAll("\\", "/");

			if (!include(normalized_path)) {
				continue;
			}

			const source_path = path.join(source_dir, relative_path);
			const target_path = path.join(target_dir, relative_path);
			const info = yield* file_system.stat(source_path);

			if (info.type === "Directory") {
				yield* file_system.makeDirectory(target_path, { recursive: true });

				continue;
			}

			if (info.type !== "File") {
				continue;
			}

			yield* file_system.makeDirectory(path.dirname(target_path), { recursive: true });
			yield* file_system.copyFile(source_path, target_path);
		}
	});
}

function GetManifestSideFiles(manifest: Record<string, unknown>) {
	return Effect.gen(function* () {
		const files = yield* Schema.decodeUnknownEffect(ManifestSideFilesSchema)(
			manifest.files ?? [],
		);

		return files.filter(
			(file) => file !== ".dist" && file !== "README.md" && file !== "LICENSE",
		);
	});
}

function CopyPackageManifest(context: PackageContext, repo_root: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const manifest = yield* ReadPackageManifest(context.package_manifest_path);
		const publish_manifest = yield* PreparePublishManifest(manifest, repo_root);

		yield* file_system.writeFileString(
			path.join(context.staging_dir, "package.json"),
			`${JSON.stringify(publish_manifest, null, 2)}\n`,
		);
	});
}

function PreparePublishManifest(manifest: Record<string, unknown>, repo_root: string) {
	return Effect.gen(function* () {
		const publish_manifest = structuredClone(manifest);

		for (const field of dependency_fields) {
			const dependencies = publish_manifest[field];

			if (!dependencies || typeof dependencies !== "object") {
				continue;
			}

			const dependency_map = dependencies as Record<string, unknown>;

			for (const [name, version] of Object.entries(dependency_map)) {
				if (typeof version !== "string" || !version.startsWith("workspace:")) {
					continue;
				}

				dependency_map[name] = yield* ResolveWorkspaceVersion(name, version, repo_root);
			}
		}

		return publish_manifest;
	});
}

function ResolveWorkspaceVersion(name: string, specifier: string, repo_root: string) {
	return Effect.gen(function* () {
		const path = yield* Path.Path;
		const version = specifier.slice("workspace:".length);

		if (version && version !== "*" && version !== "^" && version !== "~") {
			return version;
		}

		const workspace_manifest_path = path.join(repo_root, "modules", name, "package.json");
		const workspace_manifest = yield* ReadJsonFile(
			workspace_manifest_path,
			WorkspaceManifestSchema,
		);

		return version === "^" || version === "~"
			? `${version}${workspace_manifest.version}`
			: workspace_manifest.version;
	});
}

function CopyStandardFiles(context: PackageContext, repo_root: string) {
	return Effect.gen(function* () {
		const path = yield* Path.Path;

		yield* CopyOptional(
			path.join(context.package_dir, "README.md"),
			path.join(context.staging_dir, "README.md"),
		);
		yield* CopyOptional(
			path.join(repo_root, "LICENSE"),
			path.join(context.staging_dir, "LICENSE"),
		);
	});
}

function CopyManifestFiles(context: PackageContext) {
	return Effect.gen(function* () {
		const manifest = yield* ReadPackageManifest(context.package_manifest_path);
		const files = yield* GetManifestSideFiles(manifest);

		for (const file of files) {
			yield* CopyManifestFile(context, file);
		}
	});
}

function CopyManifestFile(context: PackageContext, file: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const package_path = yield* ResolveContainedPath(context.package_dir, file);
		const output_path = yield* ResolveContainedPath(context.output_dir, file);
		const staging_path = yield* ResolveContainedPath(context.staging_dir, file);
		const has_package_path = yield* file_system.exists(package_path);

		if (has_package_path) {
			yield* file_system.copy(package_path, staging_path, { overwrite: true });

			return;
		}

		const has_output_path = yield* file_system.exists(output_path);

		if (has_output_path) {
			yield* file_system.copy(output_path, staging_path, { overwrite: true });
		}
	});
}

function ResolveContainedPath(root: string, relative_path: string) {
	return Effect.gen(function* () {
		const path = yield* Path.Path;
		const resolved_root = path.resolve(root);
		const resolved_path = path.resolve(resolved_root, relative_path);
		const relative = path.relative(resolved_root, resolved_path);
		const is_outside =
			relative === "" ||
			relative === ".." ||
			relative.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relative);

		if (is_outside) {
			return yield* Effect.fail(
				new Error(`Manifest file path escapes its package root: ${relative_path}`),
			);
		}

		return resolved_path;
	});
}

function CopyOptional(source: string, target: string) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		yield* file_system
			.copyFile(source, target)
			.pipe(
				Effect.catch((error) =>
					is_not_found_error(error) ? Effect.void : Effect.fail(error),
				),
			);
	});
}

function ReadPackageManifest(path: string) {
	return ReadJsonFile(path, PackageManifestSchema);
}

function ReadJsonFile<S extends Schema.Top>(path: string, schema: S) {
	return Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const content = yield* file_system.readFileString(path);

		return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(content);
	});
}

function is_not_found_error(error: PlatformError.PlatformError): boolean {
	return error.reason._tag === "NotFound";
}

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
