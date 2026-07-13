import { language_server_package_name } from "./constants.ts";

import extension_manifest from "../../package.json" with { type: "json" };

export const language_server_package_version = extension_manifest.version;

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
