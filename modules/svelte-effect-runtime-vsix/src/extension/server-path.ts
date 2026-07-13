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
import {
	resolve_configured_server_path,
	type ScopedServerPathConfiguration,
} from "./server-path-policy.ts";
import { config_root, config_server_path, language_server_package_name } from "./constants.ts";
import type { GlobalStorageContext, InstallOutput } from "./types.ts";

import * as vscode from "vscode";

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

/** Resolves configured paths or publishes a validated immutable package cache entry. */
export class ServerPathResolver extends Context.Service<
	ServerPathResolver,
	{
		readonly get: Effect.Effect<
			string,
			unknown,
			FileSystem.FileSystem | PackageManagerCommand | PackageManagerInstallFiles | Path.Path
		>;
	}
>()("svelte-effect-runtime-vsix/ServerPathResolver") {}

export function make_server_path_resolver_layer(
	context: GlobalStorageContext,
	output_channel: InstallOutput,
): Layer.Layer<ServerPathResolver> {
	return Layer.effect(
		ServerPathResolver,
		Effect.gen(function* () {
			const semaphore = yield* Semaphore.make(1);

			return {
				get: semaphore.withPermits(1)(ResolveServerPath(context, output_channel)),
			};
		}),
	);
}

export const GetConfiguredServerPath = (output_channel?: InstallOutput) =>
	Effect.gen(function* () {
		const configuration = yield* ReadScopedServerPathConfiguration;
		const result = resolve_configured_server_path(configuration);

		if (result.ignored_workspace_path) {
			yield* AppendLine(
				output_channel,
				"Ignoring workspace svelte-effect-runtime.languageServer.path because executable paths must be configured in user or machine settings.",
			);
		}

		if (result.invalid_global_path) {
			yield* AppendLine(
				output_channel,
				"Ignoring svelte-effect-runtime.languageServer.path because it is not an absolute local filesystem path.",
			);
		}

		if (!result.path) {
			return Option.none<string>();
		}

		return yield* ResolveExistingConfiguredServerPath(result.path, output_channel);
	});

const ResolveServerPath = (context: GlobalStorageContext, output_channel: InstallOutput) =>
	Effect.gen(function* () {
		const configured_path = yield* GetConfiguredServerPath(output_channel);

		if (Option.isSome(configured_path)) {
			return configured_path.value;
		}

		return yield* InstallLanguageServer(context, output_channel);
	});

const ReadScopedServerPathConfiguration = Effect.sync((): ScopedServerPathConfiguration => {
	const inspection = vscode.workspace.getConfiguration(config_root).inspect(config_server_path);

	return {
		global_path: inspection?.globalValue,
		workspace_path: inspection?.workspaceValue,
		workspace_folder_path: inspection?.workspaceFolderValue,
		workspace_language_path: inspection?.workspaceLanguageValue,
		workspace_folder_language_path: inspection?.workspaceFolderLanguageValue,
	};
});

const InstallLanguageServer = (context: GlobalStorageContext, output_channel: InstallOutput) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const cache_root = path_service.join(
			context.globalStorageUri.fsPath,
			language_server_cache_directory,
		);
		const target_version = language_server_package_version;

		yield* file_system.makeDirectory(cache_root, { recursive: true });

		const cached_install = yield* FindPublishedLanguageServer(cache_root, target_version);

		if (Option.isSome(cached_install)) {
			return cached_install.value;
		}

		yield* AppendLine(
			output_channel,
			`Installing ${language_server_package_name}@${target_version}.`,
		);

		return yield* Effect.scoped(
			InstallAndPublishLanguageServer(cache_root, target_version, output_channel),
		);
	});

const InstallAndPublishLanguageServer = (
	cache_root: string,
	target_version: string,
	output_channel: InstallOutput,
) =>
	Effect.gen(function* () {
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
				append_line: (message) => AppendLine(output_channel, message),
			},
			verify_install: Effect.asVoid(
				VerifyLanguageServerInstall(staging_root, target_version),
			),
		});

		yield* VerifyLanguageServerInstall(staging_root, target_version);

		const winner = yield* FindPublishedLanguageServer(cache_root, target_version);

		if (Option.isSome(winner)) {
			yield* AppendLine(
				output_channel,
				`Using concurrently installed ${language_server_package_name}@${target_version}.`,
			);

			return winner.value;
		}

		const staging_name = path_service.basename(staging_root);
		const nonce = staging_name.slice(staging_prefix.length);
		const install_root = path_service.join(cache_root, `${encoded_version}-${nonce}`);
		const publication = yield* Effect.result(file_system.rename(staging_root, install_root));

		if (Result.isSuccess(publication)) {
			yield* AppendLine(output_channel, `Installed with ${package_manager}.`);

			return yield* VerifyLanguageServerInstall(install_root, target_version);
		}

		const published_after_failure = yield* FindPublishedLanguageServer(
			cache_root,
			target_version,
		);

		if (Option.isSome(published_after_failure)) {
			yield* AppendLine(
				output_channel,
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

const ResolveExistingConfiguredServerPath = (
	configured_path: string,
	output_channel?: InstallOutput,
) =>
	Effect.gen(function* () {
		const path_is_file = yield* IsRegularFile(configured_path);

		if (path_is_file) {
			return Option.some(configured_path);
		}

		yield* AppendLine(
			output_channel,
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

const AppendLine = (output_channel: InstallOutput | undefined, message: string) =>
	Effect.sync(() => output_channel?.appendLine(message));
