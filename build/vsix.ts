import { CommandName, MakeTempDirScoped, RepoRoot, RemovePath, RunCommand } from "./node-utils.ts";
import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";

const ExtensionManifestSchema = Schema.StructWithRest(
	Schema.Struct({
		name: Schema.Literals(["svelte-effect-runtime-vscode"] as const),
		version: Schema.String.pipe(
			Schema.check(
				Schema.isPattern(
					/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
				),
			),
		),
		files: Schema.optional(Schema.Array(Schema.String)),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
);

const Main = Effect.scoped(
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const repo_root = yield* RepoRoot;
		const package_dir = path.join(repo_root, "modules", "svelte-effect-runtime-vsix");
		const output_dir = path.join(repo_root, ".dist", "svelte-effect-runtime-vsix");
		const staging_dir = yield* MakeTempDirScoped("svelte-effect-runtime-vsix-");
		const staging_dist_dir = path.join(staging_dir, ".dist");

		yield* file_system.makeDirectory(staging_dist_dir, { recursive: true });
		yield* CopyExtensionOutput({
			repo_root,
			package_dir,
			output_dir,
			staging_dir,
			staging_dist_dir,
		});

		const manifest = yield* WriteManifest(package_dir, staging_dir);

		yield* PackageExtension(manifest, output_dir, staging_dir);
	}),
);

const CopyExtensionOutput = (options: {
	repo_root: string;
	package_dir: string;
	output_dir: string;
	staging_dir: string;
	staging_dist_dir: string;
}) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const { repo_root, package_dir, output_dir, staging_dir, staging_dist_dir } = options;

		yield* file_system
			.copy(path.join(output_dir, "chunks"), path.join(staging_dist_dir, "chunks"), {
				overwrite: true,
			})
			.pipe(Effect.catch((error) => IgnoreNotFound(error)));

		yield* file_system.copyFile(
			path.join(output_dir, "extension.cjs"),
			path.join(staging_dist_dir, "extension.cjs"),
		);
		yield* file_system
			.copyFile(
				path.join(output_dir, "extension.cjs.map"),
				path.join(staging_dist_dir, "extension.cjs.map"),
			)
			.pipe(Effect.catch((error) => IgnoreNotFound(error)));

		yield* file_system.copyFile(
			path.join(package_dir, "README.md"),
			path.join(staging_dir, "README.md"),
		);
		yield* file_system.copyFile(
			path.join(repo_root, "LICENSE"),
			path.join(staging_dir, "LICENSE"),
		);
	});

const WriteManifest = (package_dir: string, staging_dir: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const manifest_text = yield* file_system.readFileString(
			path.join(package_dir, "package.json"),
		);
		const manifest = yield* Schema.decodeUnknownEffect(
			Schema.fromJsonString(ExtensionManifestSchema),
		)(manifest_text);

		yield* file_system.writeFileString(
			path.join(staging_dir, "package.json"),
			`${JSON.stringify(prepare_manifest(manifest), null, 2)}\n`,
		);

		return manifest;
	});

const PackageExtension = (
	manifest: typeof ExtensionManifestSchema.Type,
	output_dir: string,
	staging_dir: string,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const command = yield* CommandName("corepack");
		const output_name = `${manifest.name}-${manifest.version}.vsix`;

		yield* file_system.makeDirectory(output_dir, { recursive: true });
		yield* RemovePath(path.join(output_dir, output_name));
		yield* RunCommand(
			command,
			[
				"pnpm",
				"dlx",
				"@vscode/vsce@3.7.1",
				"package",
				"--allow-missing-repository",
				"--no-dependencies",
				"--out",
				path.join(output_dir, output_name),
			],
			staging_dir,
			{ inherit: true },
		);
	});

function prepare_manifest(manifest: typeof ExtensionManifestSchema.Type) {
	return {
		...manifest,
		packageManager: "pnpm@11.10.0",
		files: manifest.files ?? [],
	};
}

const IgnoreNotFound = (error: PlatformError.PlatformError) =>
	error.reason._tag === "NotFound" ? Effect.void : Effect.fail(error);

NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
