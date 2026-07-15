import type { ClientMode } from "./types.ts";

export interface LanguageServerConfigurationSnapshot {
	client_mode: ClientMode;
	enabled: boolean;
	global_path: string | undefined;
	svelte_extension_available: boolean;
	workspace_folder_language_path: string | undefined;
	workspace_folder_path: string | undefined;
	workspace_language_path: string | undefined;
	workspace_path: string | undefined;
}

export type LanguageServerClientTarget = "direct" | "svelteExtension" | "unavailable";

export function resolve_language_server_client_target(
	snapshot: Pick<
		LanguageServerConfigurationSnapshot,
		"client_mode" | "svelte_extension_available"
	>,
): LanguageServerClientTarget {
	if (snapshot.client_mode === "svelteExtension") {
		return snapshot.svelte_extension_available ? "svelteExtension" : "unavailable";
	}

	return snapshot.client_mode === "auto" && snapshot.svelte_extension_available
		? "svelteExtension"
		: "direct";
}

export function configuration_snapshots_equal(
	left: LanguageServerConfigurationSnapshot,
	right: LanguageServerConfigurationSnapshot,
): boolean {
	return (
		left.client_mode === right.client_mode &&
		left.enabled === right.enabled &&
		left.svelte_extension_available === right.svelte_extension_available &&
		left.global_path === right.global_path &&
		left.workspace_folder_language_path === right.workspace_folder_language_path &&
		left.workspace_folder_path === right.workspace_folder_path &&
		left.workspace_language_path === right.workspace_language_path &&
		left.workspace_path === right.workspace_path
	);
}
