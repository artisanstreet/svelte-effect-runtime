import { language_server_package_name } from "./constants.ts";

import extension_manifest from "../../package.json" with { type: "json" };

export const language_server_package_version = extension_manifest.version;

/**
 * Creates the minimal package manifest used to install the paired
 * language-server package for this extension release.
 *
 * @example
 * ```ts
 * const manifest = make_language_server_install_manifest();
 * manifest.dependencies["svelte-effect-runtime-language-server"];
 * ```
 *
 * @since 3.4.3
 * @returns A package manifest with an exact language-server dependency.
 */
export function make_language_server_install_manifest(): {
	private: true;
	dependencies: Record<string, string>;
} {
	const version = language_server_package_version;

	return {
		private: true,
		dependencies: {
			[language_server_package_name]: version,
		},
	};
}
