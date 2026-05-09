/**
 * Low-level Vite integration entrypoints for `svelte-effect-runtime`.
 *
 * @example
 * ```ts
 * import { svelte_effect_runtime } from "svelte-effect-runtime/vite";
 *
 * export default {
 *   plugins: [svelte_effect_runtime()],
 * };
 * ```
 *
 * @module
 */
import {
  type Options as SveltePluginOptions,
  svelte,
} from "@sveltejs/vite-plugin-svelte";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin } from "vite";
import {
  effect_preprocess,
  type EffectPreprocessOptions,
} from "$/v3/preprocess.ts";

/** Options for the plain Vite + Svelte preprocess wrapper. */
export interface SvelteEffectRuntimeOptions {
  effect?: EffectPreprocessOptions;
  svelte?: SveltePluginOptions;
}

/** Options for the SvelteKit remote-function adapter plugin. */
export interface SveltekitEffectRuntimeOptions {
  /**
   * Override the client-side module SvelteKit uses for generated `.remote.ts`
   * imports so remote calls default to Effect-returning adapters.
   */
  remoteModuleId?: string;
}

const SERVER_RUNTIME_PACKAGE_IDS = new Map([
  ["svelte-effect-runtime", "svelte-effect-runtime/_server"],
  ["svelte-effect-runtime/v3", "svelte-effect-runtime/v3/_server"],
  ["svelte-effect-runtime/v4", "svelte-effect-runtime/v4/_server"],
]);
const SERVER_SOURCE_PATTERN =
  /(?:^|\/)(?:hooks\.server\.[cm]?[jt]s|.+\.server\.[cm]?[jt]s|.+\.remote\.[cm]?[jt]s)$/;

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

/**
 * Low-level Vite plugin wrapper for non-SvelteKit builds that only need the
 * Svelte preprocessor integration.
 *
 * @see https://ser.barekey.dev/content/reference/tooling
 */
export function svelte_effect_runtime(
  options: SvelteEffectRuntimeOptions = {},
): Plugin[] {
  const existingPreprocessors = arrayify(options.svelte?.preprocess);

  return svelte({
    ...options.svelte,
    preprocess: [
      effect_preprocess(options.effect),
      ...existingPreprocessors,
    ],
  });
}

function resolve_runtime_internal_path(
  source_relative_path: string,
  dist_relative_path: string,
): string {
  const relative_path = import.meta.url.endsWith(".ts")
    ? source_relative_path
    : dist_relative_path;

  return fileURLToPath(new URL(relative_path, import.meta.url));
}

function resolve_kit_internal_runtime_path(relative_path: string): string {
  const runtime_require = createRequire(resolve(process.cwd(), "package.json"));
  const kit_package_path = runtime_require.resolve(
    "@sveltejs/kit/package.json",
  );
  const kit_root = dirname(kit_package_path);

  return pathToFileURL(resolve(kit_root, relative_path)).href;
}

function resolve_runtime_dependency_path(package_id: string): string {
  const runtime_require = createRequire(import.meta.url);
  return pathToFileURL(runtime_require.resolve(package_id)).href;
}

function create_remote_runtime_module_code(): string {
  const adapter_module_path = resolve_runtime_internal_path(
    "../internal/remote-client.ts",
    "../internal/remote-client.js",
  );
  const devalue_module_path = resolve_runtime_dependency_path("devalue");
  const kit_query_module_path = resolve_kit_internal_runtime_path(
    "src/runtime/client/remote-functions/query.svelte.js",
  );
  const kit_command_module_path = resolve_kit_internal_runtime_path(
    "src/runtime/client/remote-functions/command.svelte.js",
  );
  const kit_form_module_path = resolve_kit_internal_runtime_path(
    "src/runtime/client/remote-functions/form.svelte.js",
  );
  const kit_prerender_module_path = resolve_kit_internal_runtime_path(
    "src/runtime/client/remote-functions/prerender.svelte.js",
  );
  const kit_shared_module_path = resolve_kit_internal_runtime_path(
    "src/runtime/client/remote-functions/shared.svelte.js",
  );
  const kit_client_module_path = resolve_kit_internal_runtime_path(
    "src/runtime/client/client.js",
  );
  const kit_form_utils_module_path = resolve_kit_internal_runtime_path(
    "src/runtime/form-utils.js",
  );
  const kit_shared_runtime_module_path = resolve_kit_internal_runtime_path(
    "src/runtime/shared.js",
  );

  return `
import * as devalue from ${JSON.stringify(devalue_module_path)};
import { base, app_dir } from "$app/paths/internal/client";
import * as native_query_module from ${
    JSON.stringify(kit_query_module_path)
  };
import { command as native_command } from ${
    JSON.stringify(kit_command_module_path)
  };
import { form as native_form } from ${JSON.stringify(kit_form_module_path)};
import { prerender as native_prerender } from ${
    JSON.stringify(kit_prerender_module_path)
  };
import {
  apply_refreshes,
  get_remote_request_headers,
  remote_request
} from ${JSON.stringify(kit_shared_module_path)};
import { app, invalidateAll, _goto } from ${
    JSON.stringify(kit_client_module_path)
  };
import { BINARY_FORM_CONTENT_TYPE, serialize_binary_form } from ${
    JSON.stringify(kit_form_utils_module_path)
  };
import { stringify_remote_arg } from ${
    JSON.stringify(kit_shared_runtime_module_path)
  };
import {
  create_remote_command_adapter,
  create_remote_form_adapter,
  create_remote_query_adapter
} from ${JSON.stringify(adapter_module_path)};

const decode_payload = (encoded) => devalue.parse(encoded, app?.decoders ?? {});
const request_dependencies = {
  app,
  app_dir,
  apply_refreshes,
  base,
  get_remote_request_headers,
  remote_request,
  stringify_remote_arg
};

const native_query = native_query_module.query;
const native_query_batch = Reflect.get(native_query_module, "query_batch");

export const query = create_remote_query_adapter(native_query, decode_payload, request_dependencies, "query");
export const query_batch = native_query_batch
  ? create_remote_query_adapter(native_query_batch, decode_payload, request_dependencies, "query_batch")
  : create_remote_query_adapter(native_query, decode_payload, request_dependencies, "query");
export const command = create_remote_command_adapter(native_command, decode_payload, request_dependencies);
export const prerender = create_remote_query_adapter(native_prerender, decode_payload, request_dependencies, "prerender");
export const form = create_remote_form_adapter(native_form, decode_payload, {
  binary_form_content_type: BINARY_FORM_CONTENT_TYPE,
  goto: _goto,
  invalidate_all: invalidateAll,
  serialize_binary_form,
  ...request_dependencies
});
`;
}

/**
 * Low-level Vite plugin that swaps SvelteKit's generated remote client module
 * for the Effect-aware adapters used by `effect()`.
 *
 * Prefer `effect()` unless you are assembling a custom Vite plugin stack.
 *
 * @see https://ser.barekey.dev/content/reference/tooling
 */
export function sveltekit_effect_runtime(
  options: SveltekitEffectRuntimeOptions = {},
): Plugin {
  const remote_module_id = options.remoteModuleId ??
    "\0svelte-effect-runtime:remote";

  return {
    name: "svelte-effect-runtime-remote",
    enforce: "pre",
    resolveId(id) {
      if (id === "__sveltekit/remote") {
        return remote_module_id;
      }
    },
    load(id) {
      if (id !== remote_module_id) {
        return;
      }

      return create_remote_runtime_module_code();
    },
    transform(code, id) {
      const filename = id.split("?", 1)[0];
      if (!SERVER_SOURCE_PATTERN.test(filename)) {
        return null;
      }

      let transformed = code;

      for (
        const [client_package_id, server_package_id]
          of SERVER_RUNTIME_PACKAGE_IDS
      ) {
        transformed = transformed.replaceAll(
        `"${client_package_id}"`,
        `"${server_package_id}"`,
        );
        transformed = transformed.replaceAll(
        `'${client_package_id}'`,
        `'${server_package_id}'`,
        );
      }

      if (transformed === code) {
        return null;
      }

      return transformed;
    },
  };
}
