import { transform_markup_effect } from "$/markup/transform.ts";
import { transform_script_effect } from "$/preprocess.ts";
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

interface MarkupResult {
  code: string;
}

interface PreprocessGroup {
  name: string;
  markup(options: { content: string; filename: string }): MarkupResult;
}

/**
 * Svelte preprocessor that lowers `yield*` in script and markup. Drop
 * into `svelte.config.js`:
 *
 * @example
 * ```js
 * import { preprocess } from "svelte-effect-runtime/vite";
 *
 * export default {
 *   kit: { adapter: ... },
 *   preprocess: [preprocess()],
 * };
 * ```
 *
 * @since 2.0.0
 * @returns A Svelte preprocessor group with a `markup` hook.
 */
export function preprocess(): PreprocessGroup {
  return {
    name: "svelte-effect-runtime",

    markup({ content, filename }: { content: string; filename: string }) {
      const script = find_script(content);

      let combined = content;

      if (script?.has_effect) {
        const result = transform_script_effect(script.text, filename);

        combined = content.slice(0, script.effect_attr_start) +
          content.slice(script.effect_attr_end, script.open_end) +
          result.code +
          content.slice(script.close_start);
      }

      const result = transform_markup_effect(combined, filename);

      return { code: result.code };
    },
  };
}

/**
 * Vite plugin for SvelteKit. The pre plugin rewrites server-side imports
 * to the server entrypoint; the post plugin wraps SvelteKit's generated
 * client remote exports in Effect-returning adapters.
 *
 * @example
 * ```ts
 * import { effect } from "svelte-effect-runtime/vite";
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
    make_server_rewrite_plugin(),
    make_remote_client_wrapper_plugin(options),
  ];
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
          `from "svelte-effect-runtime/_server"`,
        )
        .replace(
          /from\s+["']svelte-effect-runtime\/generators["']/g,
          `from "svelte-effect-runtime/_server"`,
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

function find_script(content: string):
  | {
    text: string;
    open_end: number;
    close_start: number;
    has_effect: boolean;
    effect_attr_start: number;
    effect_attr_end: number;
  }
  | undefined {
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined || /\bmodule\b/.test(match[1] ?? "")) {
      continue;
    }

    const attrs = match[1] ?? "";
    const effect_match = /\s+effect(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/
      .exec(attrs);
    const open_end = match.index + match[0].indexOf(">") + 1;
    const attr_start = effect_match?.index ?? attrs.length;
    const attr_end = attr_start + (effect_match?.[0].length ?? 0);

    return {
      text: match[2],
      open_end,
      close_start: match.index + match[0].lastIndexOf("<"),
      has_effect: effect_match !== null,
      effect_attr_start: match.index + "<script".length + attr_start,
      effect_attr_end: match.index + "<script".length + attr_end,
    };
  }

  return undefined;
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
    `export\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${namespace}\\.(query_batch|query|command|form|prerender)\\((["'][^"']+["'])\\);?`,
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
    `import { create_remote_query_adapter, create_remote_command_adapter, create_remote_form_adapter } from "svelte-effect-runtime/remote/client";`,
  ].join("\n");

  const helpers = [
    `const __ser_remote_base = \`\${base}/\${app_dir}/remote\`;`,
    `function __ser_decode_payload(value) { return value; }`,
  ].join("\n");

  const debug_line = options?.debug
    ? `\nconsole.log("[ser] remote client wrappers loaded");`
    : "";

  return body.replace(import_match[0], `${import_match[0]}\n${imports}`) +
    `\n${helpers}${debug_line}\n`;
}

function make_remote_export(
  name: string,
  type: string,
  id_literal: string,
  namespace: string,
): string {
  const native_call = `${namespace}.${type}(${id_literal})`;

  if (type === "command") {
    return `export const ${name} = create_remote_command_adapter(${native_call}, __ser_decode_payload);`;
  }

  if (type === "form") {
    return `export const ${name} = create_remote_form_adapter(${native_call}, __ser_decode_payload, __ser_remote_base);`;
  }

  return `export const ${name} = create_remote_query_adapter(${native_call}, __ser_decode_payload);`;
}
