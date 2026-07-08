import { test } from "vitest";
import {
	assert_false,
	assert_truthy,
	assert_equals,
	assert_throws,
	assert_string_includes,
} from "../../svelte-effect-runtime/runtime/helpers/assert.ts";
import { readFile } from "node:fs/promises";
import { LANGUAGE_SERVER_PACKAGE_NAME } from "../../../modules/svelte-effect-runtime-vsix/src/extension/constants.ts";
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

test("VS Code extension server path installs with corepack pnpm policy", async () => {
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
	assert_false(server_path_source.includes('"/c", "npm"'));
	assert_false(server_path_source.includes('command: "npm"'));
	assert_string_includes(server_path_source, '"corepack"');
	assert_string_includes(server_path_source, '"pnpm"');
	assert_string_includes(server_path_source, "--prod");
	assert_string_includes(server_path_source, "--ignore-scripts");
	assert_string_includes(server_path_source, "the configured file does not exist");
	assert_string_includes(
		server_path_source,
		"verify_language_server_install(install_root, target_version)",
	);
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
