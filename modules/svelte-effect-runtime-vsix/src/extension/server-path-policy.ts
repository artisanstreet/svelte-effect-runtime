import { isAbsolute, normalize, parse } from "node:path";
import { paths_equal } from "./paths.ts";

/**
 * Scoped configuration values for an executable language-server path.
 *
 * @example
 * ```ts
 * const configuration: ScopedServerPathConfiguration = {
 *   global_path: "/Users/me/server.cjs",
 *   workspace_path: "./workspace-server.cjs",
 * };
 * ```
 *
 * @since 2.0.0
 */
export interface ScopedServerPathConfiguration {
	/** User or machine configured path. */
	global_path?: unknown;
	/** Workspace configured path. */
	workspace_path?: unknown;
	/** Workspace-folder configured path. */
	workspace_folder_path?: unknown;
	/** Workspace language-specific configured path. */
	workspace_language_path?: unknown;
	/** Workspace-folder language-specific configured path. */
	workspace_folder_language_path?: unknown;
}

/**
 * Result of applying executable path policy to scoped configuration.
 *
 * @example
 * ```ts
 * const result: ResolvedServerPathConfiguration =
 *   resolve_configured_server_path(configuration);
 * ```
 *
 * @since 2.0.0
 */
export interface ResolvedServerPathConfiguration {
	/** Safe user or machine configured path, when one is available. */
	path: string | undefined;
	/** Workspace configured path that was ignored because it is untrusted. */
	ignored_workspace_path: string | undefined;
	/** User or machine configured path that was ignored because it is unsafe. */
	invalid_global_path: string | undefined;
}

/**
 * Configuration used to decide whether this extension may update the official
 * Svelte extension's language-server path.
 *
 * @example
 * ```ts
 * const can_configure = can_configure_svelte_language_server_path({
 *   current_path,
 *   current_path_exists: true,
 *   force: false,
 *   managed_path,
 *   server_path,
 * });
 * ```
 *
 * @since 3.4.8
 */
export interface SvelteLanguageServerPathConfiguration {
	/** Currently configured official Svelte language-server path. */
	current_path: string | undefined;
	/** Whether the currently configured path exists on disk. */
	current_path_exists: boolean;
	/** Whether user settings allow replacing existing custom paths. */
	force: boolean;
	/** Path previously written and tracked by this extension. */
	managed_path: string | undefined;
	/** SER language-server path this extension wants the Svelte extension to use. */
	server_path: string;
}

/**
 * Resolves a custom language-server path from trusted configuration scopes.
 *
 * @example
 * ```ts
 * const { path } = resolve_configured_server_path({
 *   global_path: "/Users/me/server.cjs",
 *   workspace_path: "./evil.cjs",
 * });
 * ```
 *
 * @since 2.0.0
 * @param configuration - Scoped setting values read from VS Code's
 *   configuration inspection API.
 * @returns The safe global path, plus any ignored unsafe configuration values.
 */
export function resolve_configured_server_path(
	configuration: ScopedServerPathConfiguration,
): ResolvedServerPathConfiguration {
	const global_path = normalize_configured_server_path(configuration.global_path);
	const ignored_workspace_path = get_workspace_configured_server_path(configuration);
	const invalid_global_path =
		global_path && !is_safe_language_server_path(global_path) ? global_path : undefined;

	return {
		path: invalid_global_path ? undefined : global_path,
		ignored_workspace_path,
		invalid_global_path,
	};
}

/**
 * Returns the first configured workspace path from a scoped configuration.
 *
 * @example
 * ```ts
 * const workspace_path = get_workspace_configured_server_path(configuration);
 * ```
 *
 * @since 2.0.0
 * @param configuration - Scoped setting values read from VS Code's
 *   configuration inspection API.
 * @returns The first non-empty workspace-scoped path, or undefined.
 */
export function get_workspace_configured_server_path(
	configuration: ScopedServerPathConfiguration,
): string | undefined {
	return [
		configuration.workspace_folder_language_path,
		configuration.workspace_language_path,
		configuration.workspace_folder_path,
		configuration.workspace_path,
	]
		.map(normalize_configured_server_path)
		.find((configured_path) => configured_path !== undefined);
}

/**
 * Determines whether the official Svelte extension path can be updated safely.
 *
 * @example
 * ```ts
 * if (can_configure_svelte_language_server_path(config)) update_setting();
 * ```
 *
 * @since 3.4.8
 * @param configuration - Current path ownership and existence information.
 * @returns Whether the SER extension may write the Svelte language-server path.
 */
export function can_configure_svelte_language_server_path(
	configuration: SvelteLanguageServerPathConfiguration,
): boolean {
	if (!configuration.current_path) {
		return true;
	}

	if (configuration.force) {
		return true;
	}

	if (!configuration.current_path_exists) {
		return true;
	}

	return (
		paths_equal(configuration.current_path, configuration.managed_path) ||
		paths_equal(configuration.current_path, configuration.server_path)
	);
}

/**
 * Normalizes a raw configured language-server path.
 *
 * @example
 * ```ts
 * const configured_path = normalize_configured_server_path(" /srv/server.cjs ");
 * ```
 *
 * @since 2.0.0
 * @param value - Raw configuration value read from VS Code.
 * @returns The trimmed string value, or undefined when no path is configured.
 */
export function normalize_configured_server_path(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const configured_path = value.trim();

	return configured_path.length === 0 ? undefined : configured_path;
}

/**
 * Checks whether a language-server path is safe to pass to Node.
 *
 * @example
 * ```ts
 * if (!is_safe_language_server_path(server_path)) throw new Error("unsafe");
 * ```
 *
 * @since 2.0.0
 * @param server_path - Candidate language-server script path.
 * @returns Whether the path is absolute, local, and non-empty.
 */
export function is_safe_language_server_path(server_path: string): boolean {
	const normalized_path = normalize(server_path);
	const parsed_path = parse(normalized_path);

	return (
		normalized_path.length > 0 &&
		!normalized_path.includes("\0") &&
		isAbsolute(normalized_path) &&
		!parsed_path.root.startsWith("\\\\")
	);
}

/**
 * Throws when a language-server path is unsafe to execute.
 *
 * @example
 * ```ts
 * assert_safe_language_server_path(server_path);
 * ```
 *
 * @since 2.0.0
 * @param server_path - Candidate language-server script path.
 * @returns Nothing when the path is safe.
 */
export function assert_safe_language_server_path(server_path: string): void {
	if (is_safe_language_server_path(server_path)) {
		return;
	}

	throw new Error("Language-server path must be an absolute local filesystem path.");
}
