import { scan_svelte_effect_source, type SvelteEffectSourceScan } from "./compiler/source-scan.ts";
import { collect_markup_identifier_names } from "./compiler/markup-identifiers.ts";
import { find_svelte_effect_diagnostics } from "./diagnostics.ts";
import type { Plugin } from "vite";

/**
 * Options for the {@link effect} Vite plugin.
 *
 * @example
 * ```ts
 * const options: EffectOptions = { debug: true };
 * const plugins = effect(options);
 * ```
 *
 * @since 2.0.0
 */
export interface EffectOptions {
	/** Whether to emit debug logging in the generated remote client module. */
	debug?: boolean;
}

interface SvelteComponentModuleFilter {
	set_extensions(extensions: readonly string[]): void;
	is_module(id: string): boolean;
}

interface VitePluginSvelteApi {
	options?: {
		extensions?: readonly unknown[];
	};
}

type VitePluginSvelte = Plugin & {
	api?: VitePluginSvelteApi;
};

type VitePluginSvelteWithExtensions = Plugin & {
	api: {
		options: {
			extensions: readonly string[];
		};
	};
};

const default_svelte_component_extensions = [".svelte"] as const;

/**
 * Vite plugin for SvelteKit. The server import plugin rewrites server-side
 * imports to the server entrypoint; the remote client plugin wraps SvelteKit's
 * generated client remote exports in Effect-returning adapters.
 *
 * @example
 * ```ts
 * import { effect } from "svelte-effect-runtime/compiler";
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
	const component_filter = make_svelte_component_module_filter();

	return [
		make_diagnostics_plugin(component_filter),
		make_reserved_helper_guard_plugin(component_filter),
		make_svelte_transform_plugin(component_filter),
		make_server_rewrite_plugin(),
		make_remote_client_wrapper_plugin(options),
	];
}

function make_diagnostics_plugin(component_filter: SvelteComponentModuleFilter): Plugin {
	const warned_diagnostics = new Set<string>();

	return {
		name: "svelte-effect-runtime:diagnostics",

		transform(code: string, id: string) {
			if (!component_filter.is_module(id) || !may_have_effect_diagnostics(code)) {
				return undefined;
			}

			const clean_id = id.split("?")[0] ?? id;
			const diagnostics = find_svelte_effect_diagnostics(code, clean_id);

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

function make_reserved_helper_guard_plugin(component_filter: SvelteComponentModuleFilter): Plugin {
	return {
		name: "svelte-effect-runtime:reserved-helper-guard",

		transform(code: string, id: string) {
			if (!component_filter.is_module(id) || !may_have_ser_syntax(code)) {
				return undefined;
			}

			const source_scan = scan_svelte_effect_source(code, id);

			if (!has_ser_syntax(source_scan)) {
				return undefined;
			}

			const reserved_names = find_reserved_helper_names(source_scan);

			if (reserved_names.length === 0) {
				return undefined;
			}

			this.warn(make_reserved_helper_warning(reserved_names));

			return undefined;
		},
	};
}

function make_svelte_transform_plugin(component_filter: SvelteComponentModuleFilter): Plugin {
	return {
		name: "svelte-effect-runtime:svelte-transform",

		configResolved(config) {
			const extensions = find_svelte_component_extensions(config.plugins);
			const conflicting_plugin_names = find_pre_transform_plugin_names(config.plugins);

			if (extensions) {
				component_filter.set_extensions(extensions);
			}

			if (conflicting_plugin_names.length === 0) {
				return;
			}

			config.logger.info(make_pre_transform_plugin_notice(conflicting_plugin_names));
		},

		async transform(code: string, id: string, options?: { ssr?: boolean | undefined }) {
			if (!component_filter.is_module(id) || !may_have_ser_syntax(code)) {
				return undefined;
			}

			const { transform_svelte_effect } = await import("./runtime/transform.ts");
			const result = transform_svelte_effect(code, id, {
				target: options?.ssr ? "server" : "client",
			});

			if (result.code === code) {
				return undefined;
			}

			return { code: result.code, map: null };
		},
	};
}

function make_svelte_component_module_filter(): SvelteComponentModuleFilter {
	let extensions: readonly string[] = default_svelte_component_extensions;

	return {
		set_extensions(next_extensions) {
			const normalized_extensions = normalize_svelte_component_extensions(next_extensions);

			if (normalized_extensions.length === 0) {
				return;
			}

			extensions = normalized_extensions;
		},

		is_module(id) {
			return is_svelte_component_module(id, extensions);
		},
	};
}

function normalize_svelte_component_extensions(extensions: readonly string[]): string[] {
	const normalized_extensions = extensions
		.filter((extension) => extension.length > 0)
		.map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));

	return [...new Set(normalized_extensions)];
}

function find_svelte_component_extensions(
	plugins: readonly Plugin[],
): readonly string[] | undefined {
	const svelte_plugin = plugins.find(has_svelte_component_extensions);

	return svelte_plugin?.api?.options?.extensions;
}

function has_svelte_component_extensions(plugin: Plugin): plugin is VitePluginSvelteWithExtensions {
	const candidate = plugin as VitePluginSvelte;
	const extensions = candidate.api?.options?.extensions;

	if (!plugin.name.startsWith("vite-plugin-svelte")) {
		return false;
	}

	return (
		Array.isArray(extensions) && extensions.every((extension) => typeof extension === "string")
	);
}

function find_pre_transform_plugin_names(plugins: readonly Plugin[]): string[] {
	return plugins
		.filter(
			(plugin) =>
				!plugin.name.startsWith("svelte-effect-runtime:") &&
				!is_known_framework_pre_transform_plugin(plugin.name) &&
				has_pre_transform_priority(plugin),
		)
		.map((plugin) => plugin.name);
}

const ansi_reset = "\x1b[0m";
const ansi_light_green = "\x1b[92m";

function make_pre_transform_plugin_notice(plugin_names: readonly string[]): string {
	const formatted_plugins = plugin_names.map((plugin_name) => `  - ${plugin_name}`).join("\n");

	return [
		`${ansi_light_green}[svelte-effect-runtime]${ansi_reset} Svelte Effect Runtime noticed possible Vite plugin ordering conflicts.`,
		"",
		"These plugins run before normal Svelte component transforms:",
		formatted_plugins,
		"",
		"This is usually fine, but if you see Svelte parser errors around <script effect>",
		"or yield* in components, one of those plugins may be reading component files before",
		"SER has lowered its syntax.",
	].join("\n");
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

		config() {
			return { optimizeDeps: { exclude: ["svelte-effect-runtime"] } };
		},

		async transform(code: string, id: string) {
			if (!is_server_runtime_module(id)) {
				return undefined;
			}

			if (!code.includes("svelte-effect-runtime")) {
				return undefined;
			}

			const rewritten = await rewrite_server_imports(code, id);

			if (rewritten === code) {
				return undefined;
			}

			return { code: rewritten, map: null };
		},
	};
}

async function rewrite_server_imports(code: string, id: string): Promise<string> {
	const [{ default: MagicString }, ts] = await Promise.all([
		import("magic-string"),
		import("typescript"),
	]);
	const filename = id.split("?", 2)[0] ?? id;
	const source_file = ts.createSourceFile(
		filename,
		code,
		ts.ScriptTarget.Latest,
		true,
		get_script_kind(filename, ts),
	);
	const magic = new MagicString(code);
	let changed = false;

	const rewrite_specifier = (specifier: import("typescript").StringLiteralLike) => {
		const replacement = get_server_import_replacement(specifier.text);

		if (!replacement) {
			return;
		}

		magic.overwrite(
			specifier.getStart(source_file),
			specifier.end,
			JSON.stringify(replacement),
		);
		changed = true;
	};

	const visit = (node: import("typescript").Node) => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
			rewrite_specifier(node.moduleSpecifier);
		}

		if (
			ts.isExportDeclaration(node) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			rewrite_specifier(node.moduleSpecifier);
		}

		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const [specifier] = node.arguments;

			if (specifier && ts.isStringLiteralLike(specifier)) {
				rewrite_specifier(specifier);
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(source_file);

	return changed ? magic.toString() : code;
}

function get_server_import_replacement(specifier: string): string | undefined {
	if (specifier === "svelte-effect-runtime") {
		return "svelte-effect-runtime/server";
	}

	if (specifier === "svelte-effect-runtime/internal/generators") {
		return "svelte-effect-runtime/server";
	}

	return undefined;
}

function get_script_kind(filename: string, ts: typeof import("typescript")) {
	const normalized_filename = filename.toLowerCase();

	if (has_file_extension(normalized_filename, [".tsx"])) {
		return ts.ScriptKind.TSX;
	}

	if (has_file_extension(normalized_filename, [".jsx"])) {
		return ts.ScriptKind.JSX;
	}

	if (has_file_extension(normalized_filename, [".js", ".mjs", ".cjs"])) {
		return ts.ScriptKind.JS;
	}

	return ts.ScriptKind.TS;
}

function has_file_extension(filename: string, extensions: readonly string[]): boolean {
	return extensions.some((extension) => filename.endsWith(extension));
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
				const has_runtime_package = no_external.some((entry) => entry === runtime_package);

				if (!has_runtime_package) {
					no_external.push(runtime_package);
				}

				return;
			}

			config.ssr.noExternal = [no_external, runtime_package].filter(
				(value): value is string | RegExp => value !== undefined,
			);
		},

		async transform(code: string, id: string) {
			if (!is_remote_module(id) || !code.includes("__sveltekit/remote")) {
				return undefined;
			}

			const rewritten = await rewrite_remote_client_exports(code, options);

			if (rewritten === code) {
				return undefined;
			}

			return { code: rewritten, map: null };
		},
	};
}

function is_server_runtime_module(id: string): boolean {
	const [filename] = id.split("?", 2);

	return (
		/\.(server|remote)(?:\.[cm])?\.[jt]s$/.test(filename) ||
		/(?:^|[\\/])hooks\.server(?:\.[cm])?\.[jt]s$/.test(filename)
	);
}

function is_remote_module(id: string): boolean {
	return /\.(remote|remote\.[cm]?)\.[jt]s(?:\?.*)?$/.test(id) || id.includes(".remote.");
}

function is_svelte_component_module(id: string, extensions: readonly string[]): boolean {
	const [filename, query = ""] = id.split("?", 2);

	if (!extensions.some((extension) => filename.endsWith(extension))) {
		return false;
	}

	if (query.length === 0) {
		return true;
	}

	const params = new URLSearchParams(query);
	const allowed_params = ["t", "v"];

	return [...params.keys()].every((key) => allowed_params.includes(key));
}

function has_ser_syntax(source_scan: SvelteEffectSourceScan): boolean {
	return (
		source_scan.effect_script !== undefined ||
		source_scan.markup_expressions.some((expression) => /\byield\s*\*/.test(expression.inner))
	);
}

function may_have_effect_diagnostics(code: string): boolean {
	return code.includes("Effect") || /["']effect(?:\/Effect)?["']/.test(code);
}

function may_have_ser_syntax(code: string): boolean {
	return /\byield\s*\*/.test(code) || /<script\b[^>]*\beffect(?:[\s=>]|$)/i.test(code);
}

function find_reserved_helper_names(source_scan: SvelteEffectSourceScan): string[] {
	const markup_identifier_names = collect_markup_identifier_names(source_scan);

	return ["Dispatcher", "Code"].filter((name) => markup_identifier_names.has(name));
}

function make_reserved_helper_warning(names: string[]): string {
	const quoted_names = names.map((name) => `\`${name}\``);
	const subject =
		quoted_names.length === 1
			? quoted_names[0]
			: `${quoted_names.slice(0, -1).join(", ")} and ${
					quoted_names[quoted_names.length - 1]
				}`;
	const verb = names.length === 1 ? "is" : "are";

	return [
		`[svelte-effect-runtime] ${subject} ${verb} reserved for generated markup helpers.`,
		`Rename or alias local bindings that use ${subject} before using SER syntax in this component.`,
	].join(" ");
}

/**
 * Rewrites SvelteKit's generated client remote module from:
 *
 * `export const get_post = __remote.query("hash/get_post")`
 *
 * into an Effect-aware wrapper around the same native function.
 *
 * @example
 * ```ts
 * const rewritten = await rewrite_remote_client_exports(remote_module_code);
 * ```
 *
 * @since 2.0.0
 * @param code - The generated client remote module code.
 * @param options - Optional plugin options.
 * @returns A promise that resolves to the rewritten module code.
 * @internal
 */
export async function rewrite_remote_client_exports(
	code: string,
	options?: EffectOptions,
): Promise<string> {
	const remote_client = await import("./compiler/remote-client.ts");

	return remote_client.rewrite_remote_client_exports(code, options);
}
