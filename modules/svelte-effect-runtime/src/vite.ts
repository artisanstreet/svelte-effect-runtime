import { transform_svelte_effect } from "./runtime/transform.ts";
import type { Plugin } from "vite";

/**
 * Options for the {@link effect} Vite plugin.
 *
 * @since 2.0.0
 */
export interface EffectOptions {
  /** Whether to emit debug logging in the generated remote client module. */
  debug?: boolean;
}

/**
 * Vite plugin for SvelteKit. The pre plugin rewrites server-side imports
 * to the server entrypoint; the post plugin wraps SvelteKit's generated
 * client remote exports in Effect-returning adapters.
 *
 * @example
 * ```ts
 * import { effect } from "svelte-effect-runtime";
 * import { sveltekit } from "@sveltejs/kit/vite";
 *
 * export default defineConfig({ plugins: [effect(), sveltekit()] });
 * ```
 *
 * @since 2.0.0
 * @param options - Optional configuration.
 * @returns Vite plugins that integrate the runtime with SvelteKit.
 */
export function effect(options?: EffectOptions): Plugin[] {
  return [
    make_svelte_transform_plugin(),
    make_server_rewrite_plugin(),
    make_remote_client_wrapper_plugin(options),
  ];
}

function make_svelte_transform_plugin(): Plugin {
  return {
    name: "svelte-effect-runtime:svelte-transform",
    enforce: "pre",

    transform: {
      order: "pre",
      handler(code: string, id: string) {
        if (!is_svelte_component_module(id)) {
          return undefined;
        }

        const result = transform_svelte_effect(code, id);

        if (result.code === code) {
          return undefined;
        }

        return { code: result.code, map: null };
      },
    },
  };
}

function make_server_rewrite_plugin(): Plugin {
  return {
    name: "svelte-effect-runtime:server-imports",
    enforce: "pre",

    config() {
      return { optimizeDeps: { exclude: ["svelte-effect-runtime"] } };
    },

    transform(code: string, id: string) {
      if (!is_server_runtime_module(id)) {
        return undefined;
      }

      const rewritten = code
        .replace(
          /from\s+["']svelte-effect-runtime["']/g,
          `from "svelte-effect-runtime/server"`,
        )
        .replace(
          /from\s+["']svelte-effect-runtime\/internal\/generators["']/g,
          `from "svelte-effect-runtime/server"`,
        );

      if (rewritten === code) {
        return undefined;
      }

      return { code: rewritten, map: null };
    },
  };
}

function make_remote_client_wrapper_plugin(options?: EffectOptions): Plugin {
  return {
    name: "svelte-effect-runtime:remote-client",
    enforce: "post",

    config() {
      return { ssr: { noExternal: ["svelte-effect-runtime"] } };
    },

    configResolved(config) {
      const no_external = config.ssr.noExternal;
      const runtime_package = "svelte-effect-runtime";

      if (no_external === true) {
        return;
      }

      if (Array.isArray(no_external)) {
        const has_runtime_package = no_external.some(
          (entry) => entry === runtime_package,
        );

        if (!has_runtime_package) {
          no_external.push(runtime_package);
        }

        return;
      }

      config.ssr.noExternal = [
        no_external,
        runtime_package,
      ].filter((value): value is string | RegExp => value !== undefined);
    },

    transform(code: string, id: string) {
      if (!is_remote_module(id) || !code.includes("__sveltekit/remote")) {
        return undefined;
      }

      const rewritten = rewrite_remote_client_exports(code, options);

      if (rewritten === code) {
        return undefined;
      }

      return { code: rewritten, map: null };
    },
  };
}

function is_server_runtime_module(id: string): boolean {
  return (
    id.endsWith(".server.ts") ||
    id.endsWith(".remote.ts") ||
    id.includes("hooks.server.")
  );
}

function is_remote_module(id: string): boolean {
  return /\.(remote|remote\.[cm]?)\.[jt]s(?:\?.*)?$/.test(id) ||
    id.includes(".remote.");
}

function is_svelte_component_module(id: string): boolean {
  const [filename, query = ""] = id.split("?", 2);

  if (!filename.endsWith(".svelte")) {
    return false;
  }

  if (query.length === 0) {
    return true;
  }

  const params = new URLSearchParams(query);
  const allowed_params = ["t", "v"];

  return [...params.keys()].every((key) => allowed_params.includes(key));
}

/**
 * Rewrites SvelteKit's generated client remote module from:
 *
 * `export const get_post = __remote.query("hash/get_post")`
 *
 * into an Effect-aware wrapper around the same native function.
 *
 * @since 2.0.0
 * @param code - The generated client remote module code.
 * @param options - Optional plugin options.
 * @returns The rewritten module code.
 * @internal
 */
export function rewrite_remote_client_exports(
  code: string,
  options?: EffectOptions,
): string {
  const import_match = code.match(
    /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']__sveltekit\/remote["'];?/,
  );

  if (!import_match) {
    return code;
  }

  const namespace = import_match[1];
  const export_pattern = new RegExp(
    `export\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${namespace}\\.(query_batch|query_live|query|command|form|prerender)\\((["'][^"']+["'])\\);?`,
    "g",
  );

  let replaced_any = false;
  const body = code.replace(
    export_pattern,
    (_match, name, type, id_literal) => {
      replaced_any = true;

      return make_remote_export(name, type, id_literal, namespace);
    },
  );

  if (!replaced_any) {
    return code;
  }

  const imports = [
    `import { app_dir, base } from "$app/paths/internal/client";`,
    `import { create_remote_query_adapter, create_remote_live_query_adapter, create_remote_command_adapter, create_remote_form_adapter } from "svelte-effect-runtime/internal/remote-client";`,
  ].join("\n");

  const helpers = [
    `const __SER___remote_base = \`\${base}/\${app_dir}/remote\`;`,
    `function __SER___decode_payload(value) { return value; }`,
  ].join("\n");

  const debug_line = options?.debug
    ? `console.log("[ser] remote client wrappers loaded");`
    : "";

  const injected = [
    import_match[0],
    imports,
    helpers,
    debug_line,
  ].filter(Boolean).join("\n");

  return body.replace(import_match[0], injected);
}

function make_remote_export(
  name: string,
  type: string,
  id_literal: string,
  namespace: string,
): string {
  const native_call = `${namespace}.${type}(${id_literal})`;

  if (type === "command") {
    return `export const ${name} = create_remote_command_adapter(${native_call}, __SER___decode_payload);`;
  }

  if (type === "form") {
    return `export const ${name} = create_remote_form_adapter(${native_call}, __SER___decode_payload, __SER___remote_base);`;
  }

  if (type === "query_live") {
    return `export const ${name} = create_remote_live_query_adapter(${native_call}, __SER___decode_payload);`;
  }

  return `export const ${name} = create_remote_query_adapter(${native_call}, __SER___decode_payload);`;
}
