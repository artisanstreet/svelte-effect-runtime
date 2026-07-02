import { assertEquals, assertStringIncludes } from "@std/assert";
import { LANGUAGE_SERVER_PACKAGE_NAME } from "../../../modules/svelte-effect-runtime-vsix/src/extension/constants.ts";
import {
  LANGUAGE_SERVER_PACKAGE_VERSION,
  make_language_server_install_manifest,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/language-server-package.ts";

import extension_manifest from "../../../modules/svelte-effect-runtime-vsix/package.json" with {
  type: "json",
};

Deno.test("VS Code extension pins language-server install to extension version", () => {
  const manifest = make_language_server_install_manifest();
  const dependency = manifest.dependencies[LANGUAGE_SERVER_PACKAGE_NAME];
  const exact_version =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  assertEquals(LANGUAGE_SERVER_PACKAGE_VERSION, extension_manifest.version);
  assertEquals(dependency, extension_manifest.version);
  assertEquals(exact_version.test(dependency), true);
});

Deno.test("VS Code extension server path avoids mutable npm latest lookup", async () => {
  const server_path_source = await Deno.readTextFile(
    new URL(
      "../../../modules/svelte-effect-runtime-vsix/src/extension/server-path.ts",
      import.meta.url,
    ),
  );

  assertEquals(
    server_path_source.includes("read_latest_package_version"),
    false,
  );
  assertEquals(server_path_source.includes('"view"'), false);
  assertStringIncludes(server_path_source, "--ignore-scripts");
  assertStringIncludes(
    server_path_source,
    "verify_language_server_install(install_root, target_version)",
  );
});
