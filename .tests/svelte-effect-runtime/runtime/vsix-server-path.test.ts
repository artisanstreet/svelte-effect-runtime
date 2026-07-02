import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assert_safe_language_server_path,
  get_workspace_configured_server_path,
  resolve_configured_server_path,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/server-path-policy.ts";

import extension_manifest from "../../../modules/svelte-effect-runtime-vsix/package.json" with {
  type: "json",
};

Deno.test("VS Code extension ignores workspace language-server executable paths", () => {
  const safe_path = Deno.execPath();
  const workspace_path = "scripts/workspace-server.cjs";
  const result = resolve_configured_server_path({
    global_path: safe_path,
    workspace_path,
  });

  assertEquals(result.path, safe_path);
  assertEquals(result.ignored_workspace_path, workspace_path);
  assertEquals(result.invalid_global_path, undefined);
});

Deno.test("VS Code extension refuses relative global language-server paths", () => {
  const result = resolve_configured_server_path({
    global_path: "scripts/workspace-server.cjs",
  });

  assertEquals(result.path, undefined);
  assertEquals(result.invalid_global_path, "scripts/workspace-server.cjs");
});

Deno.test("VS Code extension detects delegated workspace language-server paths", () => {
  const workspace_path = "scripts/svelte-server.cjs";
  const detected_path = get_workspace_configured_server_path({
    workspace_folder_path: workspace_path,
  });

  assertEquals(detected_path, workspace_path);
});

Deno.test("VS Code extension rejects unsafe direct server launches", () => {
  assert_safe_language_server_path(Deno.execPath());

  assertThrows(
    () => assert_safe_language_server_path("scripts/workspace-server.cjs"),
    Error,
    "absolute local filesystem path",
  );
});

Deno.test("VS Code extension marks custom executable path as restricted", () => {
  const property = extension_manifest.contributes.configuration.properties[
    "svelte-effect-runtime.languageServer.path"
  ];
  const restricted_configurations = extension_manifest.capabilities
    .untrustedWorkspaces.restrictedConfigurations;

  assertEquals(property.scope, "machine");
  assertEquals(property.restricted, true);
  assert(restricted_configurations.includes(
    "svelte-effect-runtime.languageServer.path",
  ));
});
