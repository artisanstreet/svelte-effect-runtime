import {
	PackageManagerCommand,
	PackageManagerInstallFiles,
	RunPackageManagerInstall,
} from "./package-manager-install.ts";
import {
	language_server_package_version,
	make_language_server_install_manifest,
} from "./language-server-package.ts";
import {
	Context,
	Data,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	Result,
	Schema,
	Semaphore,
} from "effect";
import { resolve_configured_server_path } from "./server-path-policy.ts";
import { language_server_package_name } from "./constants.ts";
import { ExtensionOutput } from "./extension-services.ts";
import { ExtensionConfiguration } from "./settings.ts";

const language_server_cache_directory = "language-server";
const language_server_script_path = [
	"node_modules",
	language_server_package_name,
	".dist",
	"server.cjs",
];
const language_server_runtime_path = [
	"node_modules",
	language_server_package_name,
	"runtime",
	"package.json",
];

const InstalledPackageManifestSchema = Schema.Struct({
	version: Schema.String,
});

class ServerPathError extends Data.TaggedError("ServerPathError")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

type ServerPathResolverDependencies =
	| ExtensionConfiguration
	| ExtensionOutput
	| FileSystem.FileSystem
	| PackageManagerCommand
	| PackageManagerInstallFiles
	| Path.Path;

/** Resolves configured paths or publishes a validated immutable package cache entry. */
export class ServerPathResolver extends Context.Service<
	ServerPathResolver,
	{
		readonly get: Effect.Effect<string, unknown>;
	}
>()("svelte-effect-runtime-vsix/ServerPathResolver") {}

export function make_server_path_resolver_layer(
	storage_path: string,
): Layer.Layer<ServerPathResolver, never, ServerPathResolverDependencies> {
	return Layer.effect(
		ServerPathResolver,
		Effect.gen(function* () {
			const dependency_context = yield* Effect.context<ServerPathResolverDependencies>();
			const semaphore = yield* Semaphore.make(1);
			const Get = semaphore
				.withPermits(1)(ResolveServerPath(storage_path))
				.pipe(Effect.provide(dependency_context));

			return { get: Get };
		}),
	);
}

export const GetConfiguredServerPath = Effect.gen(function* () {
	const configuration_service = yield* ExtensionConfiguration;
	const output = yield* ExtensionOutput;
	const configuration = yield* configuration_service.inspect_runtime_server_path;
	const result = resolve_configured_server_path(configuration);

	if (result.ignored_workspace_path) {
		yield* output.append_line(
			"Ignoring workspace svelte-effect-runtime.languageServer.path because executable paths must be configured in user or machine settings.",
		);
	}

	if (result.invalid_global_path) {
		yield* output.append_line(
			"Ignoring svelte-effect-runtime.languageServer.path because it is not an absolute local filesystem path.",
		);
	}

	if (!result.path) {
		return Option.none<string>();
	}

	return yield* ResolveExistingConfiguredServerPath(result.path);
});

const ResolveServerPath = (storage_path: string) =>
	Effect.gen(function* () {
		const configured_path = yield* GetConfiguredServerPath;

		if (Option.isSome(configured_path)) {
			return configured_path.value;
		}

		return yield* InstallLanguageServer(storage_path);
	});

const InstallLanguageServer = (storage_path: string) =>
	Effect.gen(function* () {
		const output = yield* ExtensionOutput;
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const cache_root = path_service.join(storage_path, language_server_cache_directory);
		const target_version = language_server_package_version;

		yield* file_system.makeDirectory(cache_root, { recursive: true });

		const cached_install = yield* FindPublishedLanguageServer(cache_root, target_version);

		if (Option.isSome(cached_install)) {
			return cached_install.value;
		}

		yield* output.append_line(`Installing ${language_server_package_name}@${target_version}.`);

		return yield* Effect.scoped(InstallAndPublishLanguageServer(cache_root, target_version));
	});

const InstallAndPublishLanguageServer = (cache_root: string, target_version: string) =>
	Effect.gen(function* () {
		const output = yield* ExtensionOutput;
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const encoded_version = encodeURIComponent(target_version);
		const staging_prefix = `.${encoded_version}-`;
		const staging_root = yield* Effect.acquireRelease(
			file_system.makeTempDirectory({
				directory: cache_root,
				prefix: staging_prefix,
			}),
			(staging_path) =>
				file_system
					.remove(staging_path, { force: true, recursive: true })
					.pipe(Effect.ignore),
		);

		yield* file_system.writeFileString(
			path_service.join(staging_root, "package.json"),
			`${JSON.stringify(make_language_server_install_manifest(), null, 2)}\n`,
		);

		const package_manager = yield* RunPackageManagerInstall({
			install_root: staging_root,
			reporter: {
				append_line: output.append_line,
			},
			verify_install: Effect.asVoid(
				VerifyLanguageServerInstall(staging_root, target_version),
			),
		});

		yield* VerifyLanguageServerInstall(staging_root, target_version);

		const winner = yield* FindPublishedLanguageServer(cache_root, target_version);

		if (Option.isSome(winner)) {
			yield* output.append_line(
				`Using concurrently installed ${language_server_package_name}@${target_version}.`,
			);

			return winner.value;
		}

		const staging_name = path_service.basename(staging_root);
		const nonce = staging_name.slice(staging_prefix.length);
		const install_root = path_service.join(cache_root, `${encoded_version}-${nonce}`);
		const publication = yield* Effect.result(file_system.rename(staging_root, install_root));

		if (Result.isSuccess(publication)) {
			yield* output.append_line(`Installed with ${package_manager}.`);

			return yield* VerifyLanguageServerInstall(install_root, target_version);
		}

		const published_after_failure = yield* FindPublishedLanguageServer(
			cache_root,
			target_version,
		);

		if (Option.isSome(published_after_failure)) {
			yield* output.append_line(
				`Using concurrently installed ${language_server_package_name}@${target_version}.`,
			);

			return published_after_failure.value;
		}

		return yield* new ServerPathError({
			cause: publication.failure,
			message: `Could not publish ${language_server_package_name}@${target_version} atomically.`,
		});
	});

const FindPublishedLanguageServer = (cache_root: string, target_version: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const encoded_version = encodeURIComponent(target_version);
		const version_prefix = `${encoded_version}-`;
		const entries = yield* file_system.readDirectory(cache_root);
		const candidates = entries
			.filter((entry) => entry === encoded_version || entry.startsWith(version_prefix))
			.toSorted();

		for (const candidate of candidates) {
			const install_root = path_service.join(cache_root, candidate);
			const verification = yield* Effect.result(
				VerifyLanguageServerInstall(install_root, target_version),
			);

			if (Result.isSuccess(verification)) {
				return Option.some(verification.success);
			}
		}

		return Option.none<string>();
	});

const ReadInstalledPackageVersion = (install_root: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const package_json_path = path_service.join(
			install_root,
			"node_modules",
			language_server_package_name,
			"package.json",
		);
		const ReadManifest = Effect.gen(function* () {
			const source = yield* file_system.readFileString(package_json_path);

			return yield* Schema.decodeUnknownEffect(
				Schema.fromJsonString(InstalledPackageManifestSchema),
			)(source);
		});
		const manifest = yield* Effect.option(ReadManifest);

		return Option.map(manifest, (package_manifest) => package_manifest.version);
	});

const ResolveExistingConfiguredServerPath = (configured_path: string) =>
	Effect.gen(function* () {
		const output = yield* ExtensionOutput;
		const path_is_file = yield* IsRegularFile(configured_path);

		if (path_is_file) {
			return Option.some(configured_path);
		}

		yield* output.append_line(
			"Ignoring svelte-effect-runtime.languageServer.path because the configured file does not exist or is not a regular file.",
		);

		return Option.none<string>();
	});

const IsRegularFile = (path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const info = yield* Effect.option(file_system.stat(path));

		return Option.isSome(info) && info.value.type === "File";
	});

const VerifyLanguageServerInstall = (install_root: string, target_version: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const script_path = path_service.join(install_root, ...language_server_script_path);
		const runtime_path = path_service.join(install_root, ...language_server_runtime_path);
		const installed_version = yield* ReadInstalledPackageVersion(install_root);
		const script_info = yield* file_system.stat(script_path).pipe(
			Effect.mapError(
				(cause) =>
					new ServerPathError({
						cause,
						message: `Installed language-server script is missing: ${script_path}.`,
					}),
			),
		);
		const runtime_info = yield* file_system.stat(runtime_path).pipe(
			Effect.mapError(
				(cause) =>
					new ServerPathError({
						cause,
						message: `Installed language-server runtime manifest is missing: ${runtime_path}.`,
					}),
			),
		);

		if (script_info.type !== "File" || runtime_info.type !== "File") {
			return yield* new ServerPathError({
				message: "Installed language-server artifacts must be regular files.",
			});
		}

		if (Option.isNone(installed_version) || installed_version.value !== target_version) {
			return yield* new ServerPathError({
				message: `Installed ${language_server_package_name}@${Option.getOrElse(
					installed_version,
					() => "unknown",
				)} does not match required ${target_version}.`,
			});
		}

		return script_path;
	});
