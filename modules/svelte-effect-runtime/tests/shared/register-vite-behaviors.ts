import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { Plugin } from "vite";
import type { VersionHarness } from "$tests/shared/versions.ts";

function get_hook(hook: unknown): (...args: Array<unknown>) => unknown {
  if (typeof hook === "function") {
    return hook as (...args: Array<unknown>) => unknown;
  }

  if (
    hook &&
    typeof hook === "object" &&
    "handler" in hook &&
    typeof hook.handler === "function"
  ) {
    return hook.handler as (...args: Array<unknown>) => unknown;
  }

  throw new Error("Expected a callable Vite hook.");
}

function get_remote_plugin(plugin: Plugin): Pick<
  Plugin,
  "load" | "resolveId" | "transform"
> {
  assertExists(plugin.resolveId);
  assertExists(plugin.load);
  assertExists(plugin.transform);

  return plugin;
}

export function register_vite_behaviors(harness: VersionHarness): void {
  const { label } = harness;

  Deno.test(
    `[${label}] sveltekit_effect_runtime resolves the remote virtual module id`,
    async () => {
      const remote_module_id = `\0ser-test-remote-${label}`;
      const plugin = get_remote_plugin(
        harness.vite.sveltekit_effect_runtime({
          remoteModuleId: remote_module_id,
        }),
      );
      const resolve_id = get_hook(plugin.resolveId);

      const resolved = await resolve_id("__sveltekit/remote", undefined, {
        attributes: {},
        isEntry: false,
      });

      assertEquals(resolved, remote_module_id);
    },
  );

  Deno.test(
    `[${label}] sveltekit_effect_runtime loads an Effect-aware remote client module`,
    async () => {
      const remote_module_id = `\0ser-test-remote-${label}`;
      const plugin = get_remote_plugin(
        harness.vite.sveltekit_effect_runtime({
          remoteModuleId: remote_module_id,
        }),
      );
      const load = get_hook(plugin.load);

      const loaded = await load(remote_module_id);

      assertEquals(typeof loaded, "string");
      assertStringIncludes(String(loaded), "create_remote_query_adapter");
      assertStringIncludes(String(loaded), "create_remote_command_adapter");
      assertStringIncludes(String(loaded), "create_remote_form_adapter");
      assertStringIncludes(String(loaded), "devalue");
      assertStringIncludes(String(loaded), "node_modules");
      assertStringIncludes(String(loaded), "import * as native_query_module");
      assertStringIncludes(String(loaded), "const native_query_batch");
      assertStringIncludes(String(loaded), 'from "$app/paths/internal/client"');
      if (String(loaded).includes('from "devalue"')) {
        throw new Error(
          "Expected devalue to resolve through the runtime package.",
        );
      }
    },
  );

  Deno.test(
    `[${label}] sveltekit_effect_runtime rewrites server-authored imports to the _server entry`,
    async () => {
      const plugin = get_remote_plugin(harness.vite.sveltekit_effect_runtime());
      const transform = get_hook(plugin.transform);
      const source = [
        'import { Query } from "svelte-effect-runtime";',
        'import { Query as QueryV3 } from "svelte-effect-runtime/v3";',
        'import { Query as QueryV4 } from "svelte-effect-runtime/v4";',
      ].join("\n");

      const transformed = await transform(
        source,
        "/src/lib/posts.remote.ts",
      );

      assertEquals(typeof transformed, "string");
      assertStringIncludes(
        String(transformed),
        '"svelte-effect-runtime/_server"',
      );
      assertStringIncludes(
        String(transformed),
        '"svelte-effect-runtime/v3/_server"',
      );
      assertStringIncludes(
        String(transformed),
        '"svelte-effect-runtime/v4/_server"',
      );
    },
  );

  Deno.test(
    `[${label}] sveltekit_effect_runtime leaves non-server modules untouched`,
    async () => {
      const plugin = get_remote_plugin(harness.vite.sveltekit_effect_runtime());
      const transform = get_hook(plugin.transform);
      const source = 'import { ClientRuntime } from "svelte-effect-runtime";';

      const transformed = await transform(source, "/src/lib/client.ts");

      assertEquals(transformed, null);
    },
  );
}
