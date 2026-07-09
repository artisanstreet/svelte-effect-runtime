import { test } from "vitest";
import {
	assert_false,
	assert_truthy,
	assert_equals,
	assert_rejects,
	assert_throws,
	assert_string_includes,
} from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import { readFile } from "node:fs/promises";
import { LANGUAGE_SERVER_PACKAGE_NAME } from "../../../modules/svelte-effect-runtime-vsix/src/extension/constants.ts";
import {
	make_package_manager_candidates,
	run_package_manager_install,
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
	LANGUAGE_SERVER_PACKAGE_VERSION,
	make_language_server_install_manifest,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-package.ts";

import extension_manifest from "../../../modules/svelte-effect-runtime-vsix/package.json" with { type: "json" };

test("VS Code extension pins language-server install to extension version", () => {
	const manifest = make_language_server_install_manifest();
	const dependency = manifest.dependencies[LANGUAGE_SERVER_PACKAGE_NAME];
	const exact_version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

	assert_equals(LANGUAGE_SERVER_PACKAGE_VERSION, extension_manifest.version);
	assert_equals(dependency, extension_manifest.version);
	assert_equals(exact_version.test(dependency), true);
});

test("VS Code extension packages a CommonJS activation entry", async () => {
	const build_source = await readFile(new URL("../../../build/ext.ts", import.meta.url), "utf8");
	const package_source = await readFile(
		new URL("../../../build/vsix.ts", import.meta.url),
		"utf8",
	);

	assert_equals(extension_manifest.main, "./.dist/extension.cjs");
	assert_string_includes(build_source, 'format: "cjs"');
	assert_string_includes(build_source, 'entryFileNames: "[name].cjs"');
	assert_string_includes(package_source, '"extension.cjs", "extension.cjs.map"');
	assert_false(package_source.includes('"extension.js", "extension.js.map"'));
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

test("VS Code extension server path installs with package-manager fallback policy", async () => {
	const server_path_source = await readFile(
		new URL(
			"../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts",
			import.meta.url,
		),
		"utf8",
	);

	assert_equals(server_path_source.includes("read_latest_package_version"), false);
	assert_equals(server_path_source.includes('"view"'), false);
	assert_false(server_path_source.includes("function npm_invocation"));
	assert_false(server_path_source.includes("run_npm("));
	assert_false(server_path_source.includes("run_pnpm_install"));
	assert_false(server_path_source.includes("corepack_pnpm_invocation"));
	assert_string_includes(server_path_source, "run_package_manager_install");
	assert_string_includes(server_path_source, "the configured file does not exist");
	assert_string_includes(
		server_path_source,
		"verify_language_server_install(install_root, target_version)",
	);
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
	const run_command: PackageManagerCommandRunner = async (invocation) => {
		attempts.push(`${invocation.command} ${invocation.args.join(" ")}`);

		if (invocation.command === "missing") {
			throw new Error("not found");
		}

		if (invocation.command === "broken" && invocation.args[0] === "install") {
			throw new Error("install failed");
		}

		return { stdout: "1.0.0", stderr: "" };
	};

	const package_manager = await run_package_manager_install({
		install_root: "cache",
		candidates,
		run_command,
		clean_install_root: async () => {},
		verify_install: async () => {},
	});

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
	const run_command: PackageManagerCommandRunner = async (invocation) => {
		if (invocation.command === "missing") {
			throw new Error("not found");
		}

		return { stdout: "1.0.0", stderr: "" };
	};

	const error = await assert_rejects(
		() =>
			run_package_manager_install({
				install_root: "cache",
				candidates,
				run_command,
				clean_install_root: async () => {},
				verify_install: async () => {
					throw new Error("server missing");
				},
			}),
		Error,
		"Unable to install",
	);

	assert_string_includes(error.message, "missing probe: not found");
	assert_string_includes(error.message, "unverified verify: server missing");
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
