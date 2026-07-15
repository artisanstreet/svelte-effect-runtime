import {
	append_sveltekit_remote_transport_bridge,
	is_sveltekit_remote_runtime_index,
	make_missing_sveltekit_remote_runtime_message,
} from "./compiler/sveltekit-remote-bridge.ts";
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
		make_svelte_transform_plugin(component_filter),
		make_server_rewrite_plugin(),
		make_remote_client_wrapper_plugin(options),
	];
}

function make_diagnostics_plugin(component_filter: SvelteComponentModuleFilter): Plugin {
	const warned_diagnostics = new Set<string>();

	return {
		name: "svelte-effect-runtime:diagnostics",

		async transform(code: string, id: string) {
			if (!component_filter.is_module(id) || !may_have_effect_diagnostics(code)) {
				return undefined;
			}

			const clean_id = id.split("?")[0] ?? id;
			const { find_svelte_effect_diagnostics } = await import("./diagnostics.ts");
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
	const ser_prerender_imports = is_remote_module(id)
		? source_file.statements.flatMap((statement) => {
				if (
					!ts.isImportDeclaration(statement) ||
					!ts.isStringLiteralLike(statement.moduleSpecifier) ||
					!is_ser_server_import(statement.moduleSpecifier.text)
				) {
					return [];
				}

				const bindings = statement.importClause?.namedBindings;

				if (
					statement.importClause?.isTypeOnly === true ||
					!bindings ||
					!ts.isNamedImports(bindings)
				) {
					return [];
				}

				return bindings.elements.filter(
					(element) =>
						!element.isTypeOnly &&
						(element.propertyName?.text ?? element.name.text) === "Prerender",
				);
			})
		: [];
	const prerender_binding_names = new Set(
		ser_prerender_imports.map((element) => element.name.text),
	);
	const prerender_namespace_names = new Set(
		is_remote_module(id)
			? source_file.statements.flatMap((statement) => {
					if (
						!ts.isImportDeclaration(statement) ||
						!ts.isStringLiteralLike(statement.moduleSpecifier) ||
						!is_ser_server_import(statement.moduleSpecifier.text) ||
						statement.importClause?.isTypeOnly === true ||
						statement.importClause?.namedBindings === undefined ||
						!ts.isNamespaceImport(statement.importClause.namedBindings)
					) {
						return [];
					}

					return [statement.importClause.namedBindings.name.text];
				})
			: [],
	);
	const ser_prerender_calls = collect_exported_ser_prerender_calls(
		source_file,
		prerender_binding_names,
		prerender_namespace_names,
		ts,
	);
	const has_sveltekit_prerender_import = source_file.statements.some(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteralLike(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text === "$app/server" &&
			statement.importClause?.isTypeOnly !== true &&
			statement.importClause?.namedBindings !== undefined &&
			ts.isNamedImports(statement.importClause.namedBindings) &&
			statement.importClause.namedBindings.elements.some(
				(element) =>
					!element.isTypeOnly &&
					(element.propertyName?.text ?? element.name.text) === "prerender" &&
					element.name.text === "prerender",
			),
	);
	const has_top_level_prerender_binding = source_file.statements.some((statement) =>
		declares_top_level_value_binding(statement, "prerender", ts),
	);
	let changed = false;

	if (ser_prerender_calls.size > 0 && !has_sveltekit_prerender_import) {
		if (has_top_level_prerender_binding) {
			throw new Error(
				`[svelte-effect-runtime] ${filename}: Prerender remote modules reserve the top-level "prerender" binding for SvelteKit. Rename the existing binding.`,
			);
		}

		const last_import = [...source_file.statements].reverse().find(ts.isImportDeclaration);
		const native_import = `import { prerender } from "$app/server";`;

		if (last_import) {
			magic.appendRight(last_import.end, `\n${native_import}`);
		} else {
			magic.prepend(`${native_import}\n`);
		}

		changed = true;
	}

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

		if (ts.isCallExpression(node) && ser_prerender_calls.has(node)) {
			const missing_arguments = Math.max(0, 3 - node.arguments.length);
			const injected_arguments = [
				...Array.from({ length: missing_arguments }, () => "undefined"),
				"prerender",
			];
			const separator =
				node.arguments.length === 0 || node.arguments.hasTrailingComma ? "" : ",";

			magic.appendLeft(node.end - 1, `${separator} ${injected_arguments.join(", ")}`);
			changed = true;
		}

		ts.forEachChild(node, visit);
	};

	visit(source_file);

	return changed ? magic.toString() : code;
}

function is_ser_server_import(specifier: string): boolean {
	return specifier === "svelte-effect-runtime" || specifier === "svelte-effect-runtime/server";
}

function is_ser_prerender_callee(
	expression: import("typescript").Expression,
	binding_names: ReadonlySet<string>,
	namespace_names: ReadonlySet<string>,
	ts: typeof import("typescript"),
): boolean {
	if (ts.isIdentifier(expression)) {
		return binding_names.has(expression.text);
	}

	return (
		ts.isPropertyAccessExpression(expression) &&
		ts.isIdentifier(expression.expression) &&
		namespace_names.has(expression.expression.text) &&
		expression.name.text === "Prerender"
	);
}

function collect_exported_ser_prerender_calls(
	source_file: import("typescript").SourceFile,
	binding_names: ReadonlySet<string>,
	namespace_names: ReadonlySet<string>,
	ts: typeof import("typescript"),
): ReadonlySet<import("typescript").CallExpression> {
	const calls = new Set<import("typescript").CallExpression>();

	const visit = (node: import("typescript").Node) => {
		if (
			ts.isCallExpression(node) &&
			is_ser_prerender_callee(node.expression, binding_names, namespace_names, ts) &&
			is_exported_variable_initializer(node, ts)
		) {
			calls.add(node);
		}

		ts.forEachChild(node, visit);
	};

	visit(source_file);

	return calls;
}

function is_exported_variable_initializer(
	node: import("typescript").CallExpression,
	ts: typeof import("typescript"),
): boolean {
	let initializer: import("typescript").Expression = node;
	let parent = initializer.parent;

	while (is_transparent_expression_wrapper(parent, initializer, ts)) {
		initializer = parent;
		parent = initializer.parent;
	}

	if (!ts.isVariableDeclaration(parent) || parent.initializer !== initializer) {
		return false;
	}

	const statement = parent.parent.parent;

	return (
		ts.isVariableStatement(statement) &&
		statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
			true
	);
}

function is_transparent_expression_wrapper(
	parent: import("typescript").Node,
	expression: import("typescript").Expression,
	ts: typeof import("typescript"),
): parent is import("typescript").Expression {
	return (
		(ts.isParenthesizedExpression(parent) ||
			ts.isAsExpression(parent) ||
			ts.isSatisfiesExpression(parent) ||
			ts.isTypeAssertionExpression(parent) ||
			ts.isNonNullExpression(parent)) &&
		parent.expression === expression
	);
}

function declares_top_level_value_binding(
	statement: import("typescript").Statement,
	name: string,
	ts: typeof import("typescript"),
): boolean {
	if (ts.isImportDeclaration(statement)) {
		const import_clause = statement.importClause;

		if (!import_clause || import_clause.isTypeOnly) {
			return false;
		}

		if (import_clause.name?.text === name) {
			return true;
		}

		const bindings = import_clause.namedBindings;

		if (bindings && ts.isNamespaceImport(bindings)) {
			return bindings.name.text === name;
		}

		return (
			bindings?.elements.some(
				(element) => !element.isTypeOnly && element.name.text === name,
			) === true
		);
	}

	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.some((declaration) =>
			binding_name_contains(declaration.name, name, ts),
		);
	}

	if (
		ts.isFunctionDeclaration(statement) ||
		ts.isClassDeclaration(statement) ||
		ts.isEnumDeclaration(statement) ||
		ts.isModuleDeclaration(statement)
	) {
		return statement.name?.getText() === name;
	}

	return ts.isImportEqualsDeclaration(statement) && statement.name.text === name;
}

function binding_name_contains(
	binding: import("typescript").BindingName,
	name: string,
	ts: typeof import("typescript"),
): boolean {
	if (ts.isIdentifier(binding)) {
		return binding.text === name;
	}

	return binding.elements.some(
		(element) =>
			!ts.isOmittedExpression(element) && binding_name_contains(element.name, name, ts),
	);
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
	let has_remote_form_module = false;
	let has_sveltekit_remote_bridge = false;

	return {
		name: "svelte-effect-runtime:remote-client",
		enforce: "post",

		buildStart() {
			has_remote_form_module = false;
			has_sveltekit_remote_bridge = false;
		},

		buildEnd(error) {
			if (error || !has_remote_form_module || has_sveltekit_remote_bridge) {
				return;
			}

			this.error(make_missing_sveltekit_remote_runtime_message());
		},

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
			if (is_sveltekit_remote_runtime_index(id)) {
				const rewritten = append_sveltekit_remote_transport_bridge(code);

				has_sveltekit_remote_bridge = true;

				if (rewritten === code) {
					return undefined;
				}

				return { code: rewritten, map: null };
			}

			if (!is_remote_module(id) || !code.includes("__sveltekit/remote")) {
				return undefined;
			}

			const has_remote_form = /\.[\s\n]*form[\s\n]*\(/.test(code);

			has_remote_form_module ||= has_remote_form;

			if (has_remote_form) {
				const resolved_runtime = await this.resolve("__sveltekit/remote", id);

				if (!resolved_runtime || !is_sveltekit_remote_runtime_index(resolved_runtime.id)) {
					this.error(make_missing_sveltekit_remote_runtime_message());
				}
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

function may_have_effect_diagnostics(code: string): boolean {
	return (
		/\byield\s*\*/.test(code) ||
		code.includes("Effect") ||
		/["']effect(?:\/Effect)?["']/.test(code)
	);
}

function may_have_ser_syntax(code: string): boolean {
	return /\byield\s*\*/.test(code) || /<script\b[^>]*\beffect(?:[\s=>]|$)/i.test(code);
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
