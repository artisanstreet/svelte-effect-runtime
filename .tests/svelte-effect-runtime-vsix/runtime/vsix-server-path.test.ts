import {
	PackageManagerCommand,
	PackageManagerCommandLive,
	PackageManagerInstallFiles,
	RunPackageManagerInstall,
	make_package_manager_candidates,
	type CommandInvocation,
	type PackageManagerCandidate,
	type PackageManagerCommandRunner,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/package-manager-install.ts";
import {
	assert_safe_language_server_path,
	can_configure_svelte_language_server_path,
	get_workspace_configured_server_path,
	resolve_configured_server_path,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/server-path-policy.ts";
import {
	language_server_package_version,
	make_language_server_install_manifest,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-package.ts";
import {
	assert_false,
	assert_equals,
	assert_string_includes,
	assert_throws,
	assert_truthy,
} from "../../svelte-effect-runtime/unit/helpers/assert.ts";
import { ServerInstallRetentionPolicyLive } from "../../../modules/svelte-effect-runtime-vsix/src/extension/server-install-retention/index.ts";
import {
	make_configuration_layer,
	make_installing_command_layer,
	make_output_layer,
	vscode_configuration,
} from "./helpers/server-path.ts";
import { language_server_package_name } from "../../../modules/svelte-effect-runtime-vsix/src/extension/constants.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { paths_equal } from "../../../modules/svelte-effect-runtime-vsix/src/extension/paths.ts";
import { Cause, Effect, Exit, FileSystem, Layer, Option } from "effect";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { test, vi } from "vitest";
import { join } from "node:path";

import extension_manifest from "../../../modules/svelte-effect-runtime-vsix/package.json" with { type: "json" };

vi.mock("vscode", () => ({}));

test("VS Code extension pins language-server install to extension version", () => {
	const manifest = make_language_server_install_manifest();
	const dependency = manifest.dependencies[language_server_package_name];
	const exact_version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

	assert_equals(language_server_package_version, extension_manifest.version);
	assert_equals(dependency, extension_manifest.version);
	assert_equals(exact_version.test(dependency), true);
});

test("VS Code extension declares a CommonJS activation entry", () => {
	assert_equals(extension_manifest.main, "./.dist/extension.cjs");
});

test("VS Code extension activates for .sv Svelte files", () => {
	const language = extension_manifest.contributes.languages.find(
		(language) => language.id === "svelte",
	);

	assert_truthy(language);
	assert_truthy(language.extensions.includes(".svelte"));
	assert_truthy(language.extensions.includes(".sv"));
	assert_truthy(
		extension_manifest.activationEvents.includes("workspaceContains:**/*.{svelte,sv}"),
	);
});

test("VS Code extension enables Emmet markup completions for Svelte files", () => {
	const emmet_include_languages =
		extension_manifest.contributes.configurationDefaults["emmet.includeLanguages"];

	assert_equals(emmet_include_languages.svelte, "html");
});

test("VS Code extension knows every supported package-manager candidate", () => {
	const candidates = make_package_manager_candidates("linux");
	const names = candidates.map((candidate) => candidate.name);

	assert_equals(names, [
		"nub",
		"aube",
		"deno",
		"bun",
		"corepack pnpm",
		"pnpm",
		"corepack yarn",
		"yarn",
		"npm",
	]);
});

test("VS Code extension wraps package-manager shims on Windows", () => {
	const candidates = make_package_manager_candidates("win32");
	const corepack_pnpm = candidates.find((candidate) => candidate.name === "corepack pnpm");

	assert_truthy(corepack_pnpm);
	assert_equals(corepack_pnpm.probe.command, "cmd.exe");
	assert_equals(corepack_pnpm.probe.args, ["/d", "/s", "/c", "corepack", "pnpm", "--version"]);
	assert_equals(corepack_pnpm.install("11.10.0").args, [
		"/d",
		"/s",
		"/c",
		"corepack",
		"pnpm",
		"install",
		"--prod",
		"--ignore-scripts",
		"--no-frozen-lockfile",
	]);
});

test("VS Code extension adapts Yarn install flags by major version", () => {
	const candidates = make_package_manager_candidates("linux");
	const yarn = candidates.find((candidate) => candidate.name === "yarn");

	assert_truthy(yarn);
	assert_equals(yarn.install("1.22.22").args, [
		"install",
		"--production=true",
		"--ignore-scripts",
		"--no-lockfile",
	]);
	assert_equals(yarn.install("4.17.0").args, ["install"]);
	assert_equals(yarn.install("4.17.0").env?.YARN_ENABLE_SCRIPTS, "false");
	assert_equals(yarn.install("4.17.0").env?.YARN_NODE_LINKER, "node-modules");
});

test("VS Code extension falls through package managers until verification succeeds", async () => {
	const attempts: string[] = [];
	const candidates: PackageManagerCandidate[] = [
		make_test_candidate("missing"),
		make_test_candidate("broken"),
		make_test_candidate("working"),
	];
	const run_command: PackageManagerCommandRunner = (invocation) =>
		Effect.gen(function* () {
			yield* Effect.sync(() => {
				attempts.push(`${invocation.command} ${invocation.args.join(" ")}`);
			});

			if (invocation.command === "missing") {
				return yield* Effect.fail(new Error("not found"));
			}

			if (invocation.command === "broken" && invocation.args[0] === "install") {
				return yield* Effect.fail(new Error("install failed"));
			}

			return { stdout: "1.0.0", stderr: "" };
		});
	const layer = make_package_manager_test_layer(run_command);
	const package_manager = await get_server_dispatcher().run(
		RunPackageManagerInstall({
			install_root: "cache",
			candidates,
			verify_install: Effect.void,
		}).pipe(Effect.provide(layer)),
	);

	assert_equals(package_manager, "working");
	assert_equals(attempts, [
		"missing --version",
		"broken --version",
		"broken install",
		"working --version",
		"working install",
	]);
});

test("VS Code extension reports every package-manager failure", async () => {
	const candidates = [make_test_candidate("missing"), make_test_candidate("unverified")];
	const run_command: PackageManagerCommandRunner = (invocation) =>
		Effect.gen(function* () {
			if (invocation.command === "missing") {
				return yield* Effect.fail(new Error("not found"));
			}

			return { stdout: "1.0.0", stderr: "" };
		});
	const layer = make_package_manager_test_layer(run_command);

	const install_exit = await get_server_dispatcher().run(
		Effect.exit(
			RunPackageManagerInstall({
				install_root: "cache",
				candidates,
				verify_install: Effect.fail(new Error("server missing")),
			}).pipe(Effect.provide(layer)),
		),
	);

	assert_truthy(Exit.isFailure(install_exit));

	if (Exit.isSuccess(install_exit)) {
		return;
	}

	const error = Cause.squash(install_exit.cause);

	assert_truthy(error instanceof Error);

	if (!(error instanceof Error)) {
		return;
	}

	assert_string_includes(error.message, "missing probe: not found");
	assert_string_includes(error.message, "unverified verify: server missing");
});

test("VS Code extension limits package-manager stdout and stderr independently", async () => {
	const stream_bytes = 6 * 1024 * 1024;
	const script = [
		`process.stdout.write(Buffer.alloc(${stream_bytes}, 97));`,
		`process.stderr.write(Buffer.alloc(${stream_bytes}, 98));`,
	].join("");
	const result = await get_server_dispatcher().run(
		Effect.gen(function* () {
			const command = yield* PackageManagerCommand;

			return yield* command.run({
				command: process.execPath,
				args: ["-e", script],
			});
		}).pipe(Effect.provide(PackageManagerCommandLive)),
	);

	assert_equals(result.stdout.length, stream_bytes);
	assert_equals(result.stderr.length, stream_bytes);
});

test("VS Code extension rejects one oversized package-manager output stream", async () => {
	const stream_bytes = 10 * 1024 * 1024 + 1;
	const script = `process.stdout.write(Buffer.alloc(${stream_bytes}, 97));`;
	const result = await get_server_dispatcher().run(
		Effect.gen(function* () {
			const command = yield* PackageManagerCommand;

			return yield* Effect.exit(
				command.run({
					command: process.execPath,
					args: ["-e", script],
				}),
			);
		}).pipe(Effect.provide(PackageManagerCommandLive)),
	);

	assert_truthy(Exit.isFailure(result));

	if (Exit.isSuccess(result)) {
		return;
	}

	assert_string_includes(Cause.pretty(result.cause), "Command output exceeded 10485760 bytes.");
});

test("VS Code extension ignores workspace language-server executable paths", () => {
	const safe_path = process.execPath;
	const workspace_path = "scripts/workspace-server.cjs";
	const result = resolve_configured_server_path({
		global_path: safe_path,
		workspace_path,
	});

	assert_equals(result.path, safe_path);
	assert_equals(result.ignored_workspace_path, workspace_path);
	assert_equals(result.invalid_global_path, undefined);
});

test("VS Code extension refuses relative global language-server paths", () => {
	const result = resolve_configured_server_path({
		global_path: "scripts/workspace-server.cjs",
	});

	assert_equals(result.path, undefined);
	assert_equals(result.invalid_global_path, "scripts/workspace-server.cjs");
});

test("VS Code extension replaces stale delegated Svelte language-server paths", () => {
	const can_configure = can_configure_svelte_language_server_path({
		current_path: process.execPath + ".missing",
		current_path_exists: false,
		force: false,
		managed_path: undefined,
		server_path: process.execPath,
	});

	assert_equals(can_configure, true);
});

test("VS Code extension preserves existing delegated Svelte custom paths", () => {
	const can_configure = can_configure_svelte_language_server_path({
		current_path: process.execPath + ".custom",
		current_path_exists: true,
		force: false,
		managed_path: undefined,
		server_path: process.execPath,
	});

	assert_equals(can_configure, false);
});

test("VS Code extension detects delegated workspace language-server paths", () => {
	const workspace_path = "scripts/svelte-server.cjs";
	const detected_path = get_workspace_configured_server_path({
		workspace_folder_path: workspace_path,
	});

	assert_equals(detected_path, workspace_path);
});

test("VS Code extension rejects unsafe direct server launches", () => {
	assert_safe_language_server_path(process.execPath);

	assert_throws(
		() => assert_safe_language_server_path("scripts/workspace-server.cjs"),
		Error,
		"absolute local filesystem path",
	);
});

test("VS Code extension marks custom executable path as restricted", () => {
	const property =
		extension_manifest.contributes.configuration.properties[
			"svelte-effect-runtime.languageServer.path"
		];
	const restricted_configurations =
		extension_manifest.capabilities.untrustedWorkspaces.restrictedConfigurations;

	assert_equals(property.scope, "machine");
	assert_equals(property.restricted, true);
	assert_truthy(restricted_configurations.includes("svelte-effect-runtime.languageServer.path"));
});

test("VS Code extension preserves POSIX path case sensitivity", () => {
	assert_false(paths_equal("/srv/SER/server.cjs", "/srv/ser/server.cjs", "linux"));
	assert_false(paths_equal("/srv/SER/server.cjs", "/srv/ser/server.cjs", "darwin"));
	assert_truthy(paths_equal("C:\\SER\\server.cjs", "c:/ser/server.cjs", "win32"));
});

test("VS Code extension accepts only regular configured server files", async () => {
	const { GetConfiguredServerPath } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const output_layer = make_output_layer([]);
	const configuration_layer = make_configuration_layer();
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const temp_directory = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-path-",
				});

				yield* Effect.sync(() => {
					vscode_configuration.global_path = temp_directory;
				});

				const directory_result = yield* GetConfiguredServerPath;
				const server_path = join(temp_directory, "server.cjs");

				yield* file_system.writeFileString(server_path, "module.exports = {};\n");
				yield* Effect.sync(() => {
					vscode_configuration.global_path = server_path;
				});

				const file_result = yield* GetConfiguredServerPath;

				return { directory_result, file_result, server_path };
			}),
		).pipe(
			Effect.provide(Layer.mergeAll(NodeFileSystem.layer, output_layer, configuration_layer)),
		),
	);

	assert_truthy(Option.isNone(result.directory_result));
	assert_truthy(Option.isSome(result.file_result));

	if (Option.isSome(result.file_result)) {
		assert_equals(result.file_result.value, result.server_path);
	}
});

test("VS Code extension publishes beside a stale invalid exact-version cache", async () => {
	const { make_server_path_resolver_layer, ServerPathResolver } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const install_attempts = { value: 0 };
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const command_layer = make_installing_command_layer(install_attempts).pipe(
		Layer.provide(node_layer),
	);
	const application_layer = Layer.mergeAll(
		node_layer,
		command_layer,
		make_output_layer(output_lines),
		make_configuration_layer(),
		Layer.succeed(PackageManagerInstallFiles, { clean: () => Effect.void }),
		ServerInstallRetentionPolicyLive,
	);
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const storage_path = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-cache-",
				});
				const cache_root = join(storage_path, "language-server", "installs");
				const encoded_version = encodeURIComponent(language_server_package_version);
				const stale_package_root = join(
					cache_root,
					encoded_version,
					"node_modules",
					language_server_package_name,
				);

				yield* file_system.makeDirectory(stale_package_root, { recursive: true });
				yield* file_system.writeFileString(
					join(stale_package_root, "package.json"),
					JSON.stringify({ version: language_server_package_version }),
				);
				yield* Effect.sync(() => {
					vscode_configuration.global_path = undefined;
				});

				const resolver_layer = make_server_path_resolver_layer(storage_path);
				const server_path = yield* Effect.gen(function* () {
					const resolver = yield* ServerPathResolver;

					return yield* resolver.get;
				}).pipe(Effect.provide(resolver_layer));
				const cache_entries = yield* file_system.readDirectory(cache_root);

				return {
					cache_entries,
					encoded_version,
					expected_prefix: join(cache_root, `${encoded_version}-`),
					expected_suffix: join(
						"node_modules",
						language_server_package_name,
						".dist",
						"server.cjs",
					),
					server_path,
				};
			}),
		).pipe(Effect.provide(application_layer)),
	);

	assert_equals(install_attempts.value, 1);
	assert_truthy(result.server_path.startsWith(result.expected_prefix));
	assert_truthy(result.server_path.endsWith(result.expected_suffix));
	assert_truthy(result.cache_entries.includes(result.encoded_version));
	assert_truthy(
		result.cache_entries.some((entry) => entry.startsWith(`${result.encoded_version}-`)),
	);
	assert_false(
		result.cache_entries.some((entry) => entry.startsWith(`.${result.encoded_version}-`)),
	);
	assert_truthy(output_lines.some((line) => line.startsWith("Installing ")));
});

test("VS Code extension prefers mapped package roots that contain executable artifacts", async () => {
	const { make_server_path_resolver_layer, ServerPathResolver } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const install_attempts = { value: 0 };
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const command_layer = make_installing_command_layer(install_attempts).pipe(
		Layer.provide(node_layer),
	);
	const application_layer = Layer.mergeAll(
		node_layer,
		command_layer,
		make_output_layer(output_lines),
		make_configuration_layer(),
		Layer.succeed(PackageManagerInstallFiles, { clean: () => Effect.void }),
		ServerInstallRetentionPolicyLive,
	);
	const package_version = language_server_package_version;
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const storage_path = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-cache-",
				});
				const cache_root = join(storage_path, "language-server", "installs");
				const encoded_version = encodeURIComponent(package_version);
				const stale_root = join(cache_root, encoded_version, "node_modules", language_server_package_name);
				const mapped_root = join(
					cache_root,
					encoded_version,
					"node_modules",
					".pnpm",
					`${language_server_package_name}@${package_version}`,
					"node_modules",
					language_server_package_name,
				);
				const mapped_url = join(
					".pnpm",
					`${language_server_package_name}@${package_version}`,
					"node_modules",
					language_server_package_name,
				);

				yield* file_system.makeDirectory(stale_root, { recursive: true });
				yield* file_system.makeDirectory(join(stale_root, "runtime"), { recursive: true });
				yield* file_system.writeFileString(
					join(stale_root, "package.json"),
					JSON.stringify({ version: package_version }),
				);
				yield* file_system.writeFileString(join(stale_root, "runtime", "package.json"), "{}");

				yield* file_system.makeDirectory(mapped_root, { recursive: true });
				yield* file_system.makeDirectory(join(mapped_root, "runtime"), { recursive: true });
				yield* file_system.makeDirectory(join(mapped_root, ".dist"), { recursive: true });
				yield* file_system.writeFileString(
					join(mapped_root, "package.json"),
					JSON.stringify({ name: language_server_package_name, version: package_version }),
				);
				yield* file_system.writeFileString(join(mapped_root, "runtime", "package.json"), "{}");
				yield* file_system.writeFileString(join(mapped_root, ".dist", "server.cjs"), "module.exports = {};\n");

				const node_modules_root = join(cache_root, encoded_version, "node_modules");
				yield* file_system.makeDirectory(node_modules_root, { recursive: true });
				yield* file_system.writeFileString(
					join(node_modules_root, ".package-map.json"),
					JSON.stringify({
						packages: {
							[`${language_server_package_name}@${package_version}`]: {
								url: mapped_url,
							},
						},
					}),
				);

				yield* file_system.writeFileString(
					join(cache_root, encoded_version, "package.json"),
					JSON.stringify({
						name: "svelte-effect-runtime-language-server-install-cache",
						private: true,
						dependencies: {
							[language_server_package_name]: package_version,
						},
					}),
				);

				yield* Effect.sync(() => {
					vscode_configuration.global_path = undefined;
				});

				const resolver_layer = make_server_path_resolver_layer(storage_path);
				const server_path = yield* Effect.gen(function* () {
					const resolver = yield* ServerPathResolver;

					return yield* resolver.get;
				}).pipe(Effect.provide(resolver_layer));

				return { encoded_version, server_path, mapped_root };
			}),
		).pipe(Effect.provide(application_layer)),
	);

	assert_equals(install_attempts.value, 0);
	assert_equals(result.server_path, join(result.mapped_root, ".dist", "server.cjs"));
	assert_false(output_lines.some((line) => line.startsWith("Installing ")));
});

test("VS Code extension resolves mapped package roots keyed by package name", async () => {
	const { make_server_path_resolver_layer, ServerPathResolver } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const install_attempts = { value: 0 };
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const command_layer = make_installing_command_layer(install_attempts).pipe(
		Layer.provide(node_layer),
	);
	const application_layer = Layer.mergeAll(
		node_layer,
		command_layer,
		make_output_layer(output_lines),
		make_configuration_layer(),
		Layer.succeed(PackageManagerInstallFiles, { clean: () => Effect.void }),
		ServerInstallRetentionPolicyLive,
	);
	const package_version = language_server_package_version;
	const result = await get_server_dispatcher().run(
		Effect.scoped(
			Effect.gen(function* () {
				const file_system = yield* FileSystem.FileSystem;
				const storage_path = yield* file_system.makeTempDirectoryScoped({
					prefix: "ser-vsix-cache-",
				});
				const cache_root = join(storage_path, "language-server", "installs");
				const encoded_version = encodeURIComponent(package_version);
				const stale_root = join(cache_root, encoded_version, "node_modules", language_server_package_name);
				const mapped_root = join(
					cache_root,
					encoded_version,
					"node_modules",
					".pnpm",
					`${language_server_package_name}@${package_version}`,
					"node_modules",
					language_server_package_name,
				);
				const mapped_url = join(
					".pnpm",
					`${language_server_package_name}@${package_version}`,
					"node_modules",
					language_server_package_name,
				);

				yield* file_system.makeDirectory(stale_root, { recursive: true });
				yield* file_system.makeDirectory(join(stale_root, "runtime"), { recursive: true });
				yield* file_system.writeFileString(
					join(stale_root, "package.json"),
					JSON.stringify({ version: package_version }),
				);
				yield* file_system.writeFileString(join(stale_root, "runtime", "package.json"), "{}");

				yield* file_system.makeDirectory(mapped_root, { recursive: true });
				yield* file_system.makeDirectory(join(mapped_root, "runtime"), { recursive: true });
				yield* file_system.makeDirectory(join(mapped_root, ".dist"), { recursive: true });
				yield* file_system.writeFileString(
					join(mapped_root, "package.json"),
					JSON.stringify({ name: language_server_package_name, version: package_version }),
				);
				yield* file_system.writeFileString(
					join(mapped_root, "runtime", "package.json"),
					"{}",
				);
				yield* file_system.writeFileString(
					join(mapped_root, ".dist", "server.cjs"),
					"module.exports = {};\n",
				);

				const node_modules_root = join(cache_root, encoded_version, "node_modules");
				yield* file_system.makeDirectory(node_modules_root, { recursive: true });
				yield* file_system.writeFileString(
					join(node_modules_root, ".package-map.json"),
					JSON.stringify({
						packages: {
							[`${language_server_package_name}`]: {
								url: mapped_url,
							},
						},
					}),
				);

				yield* file_system.writeFileString(
					join(cache_root, encoded_version, "package.json"),
					JSON.stringify({
						name: "svelte-effect-runtime-language-server-install-cache",
						private: true,
						dependencies: {
							[language_server_package_name]: package_version,
						},
					}),
				);

				yield* Effect.sync(() => {
					vscode_configuration.global_path = undefined;
				});

				const resolver_layer = make_server_path_resolver_layer(storage_path);
				const server_path = yield* Effect.gen(function* () {
					const resolver = yield* ServerPathResolver;

					return yield* resolver.get;
				}).pipe(Effect.provide(resolver_layer));

				return { encoded_version, server_path, mapped_root };
			}),
		).pipe(Effect.provide(application_layer)),
	);

	assert_equals(install_attempts.value, 0);
	assert_equals(result.server_path, join(result.mapped_root, ".dist", "server.cjs"));
	assert_false(output_lines.some((line) => line.startsWith("Installing ")));
});

test("VS Code extension atomically shares one published cache across windows", async () => {
	const { make_server_path_resolver_layer, ServerPathResolver } =
		await import("../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts");
	const install_attempts = { value: 0 };
	const output_lines: string[] = [];
	const node_layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
	const command_layer = make_installing_command_layer(install_attempts, 20).pipe(
		Layer.provide(node_layer),
	);
	const application_layer = Layer.mergeAll(
		node_layer,
		command_layer,
		make_output_layer(output_lines),
		make_configuration_layer(),
		Layer.succeed(PackageManagerInstallFiles, { clean: () => Effect.void }),
		ServerInstallRetentionPolicyLive,
	);
	const Program = Effect.scoped(
		Effect.gen(function* () {
			const file_system = yield* FileSystem.FileSystem;
			const storage_path = yield* file_system.makeTempDirectoryScoped({
				prefix: "ser-vsix-concurrent-cache-",
			});
			const first_layer = make_server_path_resolver_layer(storage_path);
			const second_layer = make_server_path_resolver_layer(storage_path);
			const ResolveWith = (layer: typeof first_layer) =>
				Effect.gen(function* () {
					const resolver = yield* ServerPathResolver;

					return yield* resolver.get;
				}).pipe(Effect.provide(layer));

			yield* Effect.sync(() => {
				vscode_configuration.global_path = undefined;
			});

			const server_paths = yield* Effect.all(
				[ResolveWith(first_layer), ResolveWith(second_layer)],
				{ concurrency: "unbounded" },
			);
			const cache_root = join(storage_path, "language-server", "installs");
			const cache_entries = yield* file_system.readDirectory(cache_root);
			const published_entries = cache_entries.filter((entry) => !entry.startsWith("."));
			const encoded_version = encodeURIComponent(language_server_package_version);
			const expected_prefix = join(cache_root, `${encoded_version}-`);
			const expected_suffix = join(
				"node_modules",
				language_server_package_name,
				".dist",
				"server.cjs",
			);
			const server_path_types = yield* Effect.forEach(server_paths, (server_path) =>
				file_system.stat(server_path).pipe(Effect.map((info) => info.type)),
			);

			return {
				cache_entries,
				encoded_version,
				expected_prefix,
				expected_suffix,
				published_entries,
				server_paths,
				server_path_types,
			};
		}),
	).pipe(Effect.provide(application_layer));
	const result = await get_server_dispatcher().run(Program);

	assert_equals(install_attempts.value, 2);
	assert_truthy(
		result.server_paths.every(
			(server_path) =>
				server_path.startsWith(result.expected_prefix) &&
				server_path.endsWith(result.expected_suffix),
		),
	);
	assert_equals(result.server_path_types, ["File", "File"]);
	assert_truthy(result.published_entries.length >= 1 && result.published_entries.length <= 2);
	assert_truthy(
		result.published_entries.every((entry) => entry.startsWith(`${result.encoded_version}-`)),
	);
	assert_false(
		result.cache_entries.some((entry) => entry.startsWith(`.${result.encoded_version}-`)),
	);
});

function make_test_candidate(name: string): PackageManagerCandidate {
	return {
		name,
		probe: make_test_invocation(name, ["--version"]),
		install: () => make_test_invocation(name, ["install"]),
	};
}

function make_test_invocation(command: string, args: string[]): CommandInvocation {
	return { command, args };
}

function make_package_manager_test_layer(run_command: PackageManagerCommandRunner) {
	return Layer.mergeAll(
		Layer.succeed(PackageManagerCommand, { run: run_command }),
		Layer.succeed(PackageManagerInstallFiles, {
			clean: () => Effect.void,
		}),
	);
}
