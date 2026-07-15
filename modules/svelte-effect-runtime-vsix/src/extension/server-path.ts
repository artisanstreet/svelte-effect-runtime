import {
	CanUseServerInstall,
	MakeServerInstallRetention,
	MakeServerInstallStaging,
	type ServerInstallRetentionDependencies,
} from "./server-install-retention/index.ts";
import {
	PackageManagerCommand,
	PackageManagerInstallFiles,
	RunPackageManagerInstall,
} from "./package-manager-install.ts";
import {
	Context,
	Data,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	PlatformError,
	Result,
	Schema,
	Semaphore,
} from "effect";
import {
	language_server_package_version,
	make_language_server_install_manifest,
} from "./language-server-package.ts";
import { resolve_configured_server_path } from "./server-path-policy.ts";
import { language_server_package_name } from "./constants.ts";
import { ExtensionOutput } from "./extension-services.ts";
import { ExtensionConfiguration } from "./settings.ts";

const language_server_cache_directory = "language-server";
const language_server_install_directory = "installs";
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

type ServerPathResolverLayerDependencies =
	| ServerInstallRetentionDependencies
	| ServerPathResolverDependencies;

interface PublishedLanguageServer {
	install_root: string;
	server_path: string;
}

interface ResolvedLanguageServer {
	install_root: Option.Option<string>;
	server_path: string;
}

type ManagedServerInstallRoot =
	| { readonly _tag: "Managed"; readonly install_root: string }
	| { readonly _tag: "Missing" }
	| { readonly _tag: "Unmanaged" };

export class ServerPathResolver extends Context.Service<
	ServerPathResolver,
	{
		readonly get: Effect.Effect<string, unknown>;
	}
>()("svelte-effect-runtime-vsix/ServerPathResolver") {}

export function make_server_path_resolver_layer(
	storage_path: string,
): Layer.Layer<ServerPathResolver, never, ServerPathResolverLayerDependencies> {
	const resolver_layer = Layer.effect(
		ServerPathResolver,
		Effect.gen(function* () {
			const dependency_context = yield* Effect.context<ServerPathResolverLayerDependencies>();
			const path_service = yield* Path.Path;
			const cache_root = get_server_install_cache_root(path_service, storage_path);
			const retention = yield* MakeServerInstallRetention(cache_root);
			const semaphore = yield* Semaphore.make(1);
			const Get = semaphore.withPermits(1)(
				Effect.gen(function* () {
					let allow_configured_path = true;
					let resolved = yield* ResolveServerPath(storage_path, allow_configured_path);

					while (Option.isSome(resolved.install_root)) {
						const lease_created = yield* retention.ensure_lease(
							resolved.install_root.value,
							resolved.server_path,
						);

						if (lease_created) {
							break;
						}

						allow_configured_path = false;
						resolved = yield* ResolveServerPath(storage_path, allow_configured_path);
					}

					const protected_install_root = yield* FindProtectedServerInstall(
						cache_root,
						resolved.install_root,
					);

					yield* retention.cleanup(protected_install_root);

					return resolved.server_path;
				}).pipe(Effect.provide(dependency_context)),
			);

			return { get: Get };
		}),
	);

	return resolver_layer;
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

const ResolveServerPath = (storage_path: string, allow_configured_path: boolean) =>
	Effect.gen(function* () {
		const path_service = yield* Path.Path;
		const cache_root = get_server_install_cache_root(path_service, storage_path);
		const configured_path = allow_configured_path
			? yield* GetConfiguredServerPath
			: Option.none<string>();

		if (Option.isSome(configured_path)) {
			const managed_install_root = yield* FindManagedServerInstallRoot(
				cache_root,
				configured_path.value,
			);

			if (managed_install_root._tag === "Missing") {
				return yield* ResolveInstalledLanguageServer(storage_path);
			}

			return {
				install_root:
					managed_install_root._tag === "Managed"
						? Option.some(managed_install_root.install_root)
						: Option.none<string>(),
				server_path: configured_path.value,
			} satisfies ResolvedLanguageServer;
		}

		return yield* ResolveInstalledLanguageServer(storage_path);
	});

const ResolveInstalledLanguageServer = (storage_path: string) =>
	Effect.gen(function* () {
		const published = yield* InstallLanguageServer(storage_path);

		return {
			install_root: Option.some(published.install_root),
			server_path: published.server_path,
		} satisfies ResolvedLanguageServer;
	});

const InstallLanguageServer = (storage_path: string) =>
	Effect.gen(function* () {
		const output = yield* ExtensionOutput;
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const cache_root = get_server_install_cache_root(path_service, storage_path);
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
		const staging = yield* MakeServerInstallStaging(cache_root, target_version);
		const staging_root = staging.root;

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

		const install_root = path_service.join(
			cache_root,
			`${encoded_version}-${staging.install_identity}`,
		);
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

		return Option.none<PublishedLanguageServer>();
	});

const FindProtectedServerInstall = (
	cache_root: string,
	selected_install_root: Option.Option<string>,
) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;

		if (Option.isSome(selected_install_root)) {
			return selected_install_root;
		}

		const cache_exists = yield* file_system.exists(cache_root);

		if (!cache_exists) {
			return Option.none<string>();
		}

		const published = yield* FindPublishedLanguageServer(
			cache_root,
			language_server_package_version,
		).pipe(Effect.catch(() => Effect.succeed(Option.none<PublishedLanguageServer>())));

		return Option.map(published, (server) => server.install_root);
	});

const FindManagedServerInstallRoot = (cache_root: string, server_path: string) =>
	Effect.gen(function* () {
		const file_system = yield* FileSystem.FileSystem;
		const path_service = yield* Path.Path;
		const install_root = find_direct_server_install_root(path_service, cache_root, server_path);

		if (Option.isSome(install_root)) {
			return make_managed_server_install_root(path_service, install_root.value);
		}

		const cache_exists = yield* file_system.exists(cache_root);

		if (!cache_exists) {
			return { _tag: "Unmanaged" } satisfies ManagedServerInstallRoot;
		}

		const canonical_paths = yield* Effect.result(
			Effect.all({
				cache_root: file_system.realPath(cache_root),
				server_path: file_system.realPath(server_path),
			}),
		);

		if (Result.isFailure(canonical_paths)) {
			if (is_missing_path_error(canonical_paths.failure)) {
				return { _tag: "Missing" } satisfies ManagedServerInstallRoot;
			}

			return yield* Effect.fail(canonical_paths.failure);
		}

		const canonical_install_root = find_direct_server_install_root(
			path_service,
			canonical_paths.success.cache_root,
			canonical_paths.success.server_path,
		);

		return Option.match(canonical_install_root, {
			onNone: () => ({ _tag: "Unmanaged" }) satisfies ManagedServerInstallRoot,
			onSome: (root) =>
				make_managed_server_install_root(
					path_service,
					path_service.join(cache_root, path_service.basename(root)),
				),
		});
	});

function make_managed_server_install_root(
	path_service: Path.Path,
	install_root: string,
): ManagedServerInstallRoot {
	if (path_service.basename(install_root).startsWith(".")) {
		return { _tag: "Missing" };
	}

	return {
		_tag: "Managed",
		install_root,
	};
}

function is_missing_path_error(error: unknown): error is PlatformError.PlatformError {
	return error instanceof PlatformError.PlatformError && error.reason._tag === "NotFound";
}

function find_direct_server_install_root(
	path_service: Path.Path,
	cache_root: string,
	candidate_path: string,
): Option.Option<string> {
	const relative_path = path_service.relative(
		path_service.resolve(cache_root),
		path_service.resolve(candidate_path),
	);
	const segments = relative_path.split(path_service.sep);
	const is_outside =
		path_service.isAbsolute(relative_path) ||
		relative_path === ".." ||
		relative_path.startsWith(`..${path_service.sep}`);

	if (is_outside || segments.length < 2 || segments[0].length === 0) {
		return Option.none<string>();
	}

	return Option.some(path_service.join(cache_root, segments[0]));
}

function get_server_install_cache_root(path_service: Path.Path, storage_path: string): string {
	return path_service.join(
		storage_path,
		language_server_cache_directory,
		language_server_install_directory,
	);
}

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
		const can_use_install = yield* CanUseServerInstall(install_root);
		const installed_version = yield* ReadInstalledPackageVersion(install_root);

		if (!can_use_install) {
			return yield* new ServerPathError({
				message: `Installed language-server is being retired: ${install_root}.`,
			});
		}

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

		return {
			install_root,
			server_path: script_path,
		} satisfies PublishedLanguageServer;
	});
