import { LANGUAGE_SERVER_PACKAGE_NAME } from "./constants.ts";

import extension_manifest from "../../package.json" with { type: "json" };

export const LANGUAGE_SERVER_PACKAGE_VERSION = extension_manifest.version;

/**
 * Creates the minimal package manifest used to install the paired
 * language-server package for this extension release.
 *
 * @example
 * ```ts
 * await writeFile("package.json", JSON.stringify(make_language_server_install_manifest()));
 * ```
 *
 * @since 3.4.3
 * @returns A package manifest with an exact language-server dependency.
 */
export function make_language_server_install_manifest(): {
	private: true;
	dependencies: Record<string, string>;
} {
	const version = LANGUAGE_SERVER_PACKAGE_VERSION;

	return {
		private: true,
		dependencies: {
			[LANGUAGE_SERVER_PACKAGE_NAME]: version,
		},
	};
}
