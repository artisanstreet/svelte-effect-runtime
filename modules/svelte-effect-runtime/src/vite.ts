import { VitePreTransformPluginConflictError } from "./errors.ts";
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
    make_diagnostics_plugin(),
    make_svelte_component_transform_plugin(),
    make_server_rewrite_plugin(),
    make_remote_client_wrapper_plugin(options),
  ];
}

function make_diagnostics_plugin(): Plugin {
  const warned_diagnostics = new Set<string>();

  return {
    name: "svelte-effect-runtime:diagnostics",

    transform(code: string, id: string) {
      if (!is_svelte_component_module(id) || !code.includes("Effect.")) {
        return undefined;
      }

      const clean_id = id.split("?")[0] ?? id;
      const diagnostics = find_effect_event_handler_diagnostics(
        code,
        clean_id,
      );

      for (const diagnostic of diagnostics) {
        const diagnostic_key = [
          clean_id,
          diagnostic.line,
          diagnostic.column,
          diagnostic.message,
        ].join(":");

        if (warned_diagnostics.has(diagnostic_key)) {
          continue;
        }

        warned_diagnostics.add(diagnostic_key);

        this.warn({
          id: clean_id,
          message: diagnostic.message,
          loc: {
            line: diagnostic.line,
            column: diagnostic.column,
          },
        });
      }

      return undefined;
    },
  };
}

function make_svelte_component_transform_plugin(): Plugin {
  return {
    name: "svelte-effect-runtime:component-syntax",

    configResolved(config) {
      const conflicting_plugin_names = find_pre_transform_plugin_names(
        config.plugins,
      );

      if (conflicting_plugin_names.length === 0) {
        return;
      }

      throw new VitePreTransformPluginConflictError(
        conflicting_plugin_names,
      );
    },

    async transform(code: string, id: string) {
      if (
        !is_svelte_component_module(id) || !has_component_effect_syntax(code)
      ) {
        return undefined;
      }

      const runtime = await import("./runtime/preprocess.ts");
      const group = runtime.preprocess();
      const clean_id = id.split("?")[0] ?? id;
      const result = group.markup({ content: code, filename: clean_id });

      if (result.code === code) {
        return undefined;
      }

      return { code: result.code, map: null };
    },
  };
}

interface EffectEventHandlerDiagnostic {
  message: string;
  line: number;
  column: number;
}

function find_effect_event_handler_diagnostics(
  code: string,
  filename: string,
): EffectEventHandlerDiagnostic[] {
  const diagnostics: EffectEventHandlerDiagnostic[] = [];
  const pattern = /\b(on(?::[A-Za-z_$][\w$-]*|[a-z][\w$-]*))\s*=\s*\{/g;

  for (const match of code.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const open = match.index + match[0].lastIndexOf("{");

    if (is_inside_svelte_excluded_block(code, open)) {
      continue;
    }

    const close = find_closing_brace(code, open + 1);

    if (close === -1) {
      continue;
    }

    const expression_text = code.slice(open + 1, close).trim();

    if (!is_potential_misused_effect_event_expression(expression_text)) {
      continue;
    }

    const loc = get_line_column(code, match.index);
    const attribute_name = match[1];

    diagnostics.push({
      line: loc.line,
      column: loc.column,
      message: make_effect_event_handler_warning(
        filename,
        attribute_name,
        expression_text,
      ),
    });
  }

  return diagnostics;
}

function is_potential_misused_effect_event_expression(
  expression_text: string,
): boolean {
  if (/^yield\s*\*/.test(expression_text)) {
    return false;
  }

  if (/\bEffect\.run(?:Promise|Sync|Fork)\b/.test(expression_text)) {
    return false;
  }

  return /\bEffect\.(?:gen|succeed|fail|try|tryPromise|promise|sync|all|void|log)\b/
    .test(expression_text);
}

function make_effect_event_handler_warning(
  filename: string,
  attribute_name: string,
  expression_text: string,
): string {
  const problematic = `${attribute_name}={${expression_text}}`;
  const fixed = `${attribute_name}={yield* ${expression_text}}`;

  return [
    `[svelte-effect-runtime] Detected an event attribute that looks like an Effect but is not written with yield*.`,
    `${filename}: ${problematic}`,
    `If you are trying to use Effect in this event handler, use yield* at the beginning.`,
    `Use: ${fixed}`,
  ].join("\n");
}

function is_inside_svelte_excluded_block(code: string, pos: number): boolean {
  const script = find_svelte_tag_range(code, "script", pos);
  const style = find_svelte_tag_range(code, "style", pos);

  return (
    (script !== undefined && pos < script.end && pos > script.start) ||
    (style !== undefined && pos < style.end && pos > style.start)
  );
}

function find_svelte_tag_range(
  code: string,
  tag: string,
  after_pos: number,
): { start: number; end: number } | undefined {
  const pattern = new RegExp(
    `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,
    "gi",
  );

  for (const match of code.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const end = match.index + match[0].length;

    if (match.index <= after_pos && after_pos < end) {
      return { start: match.index, end };
    }
  }

  return undefined;
}

function find_closing_brace(code: string, start: number): number {
  let depth = 0;

  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];

    if (ch === "{" && code[i - 1] !== "$") {
      depth += 1;
    } else if (ch === "}") {
      if (depth === 0) {
        return i;
      }

      depth -= 1;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      i = skip_string(code, i, ch);

      if (i === -1) {
        return -1;
      }
    } else if (ch === "/" && code[i + 1] === "/") {
      i = skip_line_comment(code, i);
    } else if (ch === "/" && code[i + 1] === "*") {
      i = skip_block_comment(code, i);

      if (i === -1) {
        return -1;
      }
    }
  }

  return -1;
}

function skip_string(code: string, start: number, quote: string): number {
  for (let i = start + 1; i < code.length; i += 1) {
    if (code[i] === "\\") {
      i += 1;
      continue;
    }

    if (code[i] === quote) {
      return i;
    }
  }

  return -1;
}

function skip_line_comment(code: string, start: number): number {
  for (let i = start + 2; i < code.length; i += 1) {
    if (code[i] === "\n") {
      return i;
    }
  }

  return code.length;
}

function skip_block_comment(code: string, start: number): number {
  for (let i = start + 2; i < code.length; i += 1) {
    if (code[i] === "*" && code[i + 1] === "/") {
      return i + 1;
    }
  }

  return -1;
}

function get_line_column(
  code: string,
  position: number,
): { line: number; column: number } {
  const before = code.slice(0, position);
  const lines = before.split("\n");
  const line = lines.length;
  const column = lines.at(-1)?.length ?? 0;

  return { line, column };
}

function find_pre_transform_plugin_names(plugins: readonly Plugin[]): string[] {
  return plugins
    .filter((plugin) =>
      !plugin.name.startsWith("svelte-effect-runtime:") &&
      !is_known_framework_pre_transform_plugin(plugin.name) &&
      has_pre_transform_priority(plugin)
    )
    .map((plugin) => plugin.name);
}

function is_known_framework_pre_transform_plugin(name: string): boolean {
  return name.startsWith("vite:") || name === "vite-plugin-svelte:preprocess";
}

function has_pre_transform_priority(plugin: Plugin): boolean {
  if (plugin.enforce === "pre" && plugin.transform) {
    return true;
  }

  if (
    typeof plugin.transform === "object" &&
    plugin.transform !== null &&
    "order" in plugin.transform &&
    plugin.transform.order === "pre"
  ) {
    return true;
  }

  return false;
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

      if (no_external === true) {
        return;
      }

      if (Array.isArray(no_external)) {
        if (!no_external.includes("svelte-effect-runtime")) {
          no_external.push("svelte-effect-runtime");
        }

        return;
      }

      config.ssr.noExternal = [
        no_external,
        "svelte-effect-runtime",
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

function is_svelte_component_module(id: string): boolean {
  const clean_id = id.split("?")[0] ?? id;

  return clean_id.endsWith(".svelte");
}

function has_component_effect_syntax(code: string): boolean {
  return code.includes("yield*") || /<script\b[^>]*\beffect\b/.test(code);
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
    `const __ser_remote_base = \`\${base}/\${app_dir}/remote\`;`,
    `function __ser_decode_payload(value) { return value; }`,
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
    return `export const ${name} = create_remote_command_adapter(${native_call}, __ser_decode_payload);`;
  }

  if (type === "form") {
    return `export const ${name} = create_remote_form_adapter(${native_call}, __ser_decode_payload, __ser_remote_base);`;
  }

  if (type === "query_live") {
    return `export const ${name} = create_remote_live_query_adapter(${native_call}, __ser_decode_payload);`;
  }

  return `export const ${name} = create_remote_query_adapter(${native_call}, __ser_decode_payload);`;
}
