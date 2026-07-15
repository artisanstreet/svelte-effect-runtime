import { isAbsolute, normalize, parse } from "node:path";
import { paths_equal } from "./paths.ts";
import { Option, Schema } from "effect";

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

export interface ResolvedServerPathConfiguration {
	/** Safe user or machine configured path, when one is available. */
	path: string | undefined;
	/** Workspace configured path that was ignored because it is untrusted. */
	ignored_workspace_path: string | undefined;
	/** User or machine configured path that was ignored because it is unsafe. */
	invalid_global_path: string | undefined;
}

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

/** Ignores workspace-scoped overrides and accepts only safe global server paths. */
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

export function normalize_configured_server_path(value: unknown): string | undefined {
	const decoded_value = Schema.decodeUnknownOption(Schema.String)(value);

	if (Option.isNone(decoded_value)) {
		return undefined;
	}

	const configured_path = decoded_value.value.trim();

	return configured_path.length === 0 ? undefined : configured_path;
}

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

export function assert_safe_language_server_path(server_path: string): void {
	if (is_safe_language_server_path(server_path)) {
		return;
	}

	throw new Error("Language-server path must be an absolute local filesystem path.");
}
