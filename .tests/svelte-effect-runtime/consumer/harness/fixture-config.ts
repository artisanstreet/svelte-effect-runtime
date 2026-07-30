import type { SvelteKitProfile } from "./sveltekit-profiles.ts";

const paths_origin_placeholder = '__CONFORMANCE_PATHS_ORIGIN__: "__CONFORMANCE_ORIGIN__",';

/** Fixture sources address the library root through SvelteKit 2's alias. */
const lib_alias_pattern = /(?<=["'])\$lib(?=\/)/g;

/** Subpath import that replaces the alias on SvelteKit 3.0.0-next.9 and later. */
export const lib_subpath_import = "#lib";

export const lib_subpath_imports: Readonly<Record<string, string>> = {
	[`${lib_subpath_import}/*`]: "./src/lib/*",
};

/**
 * Rewrites a fixture source onto the library specifier the profile supports.
 *
 * @param source - Fixture file contents.
 * @param profile - Compatibility profile being prepared.
 * @returns The source addressed through the supported library specifier.
 */
export function render_fixture_lib_imports(source: string, profile: SvelteKitProfile): string {
	if (!profile.supports_subpath_lib_imports) {
		return source;
	}

	return source.replace(lib_alias_pattern, lib_subpath_import);
}

export function render_fixture_sveltekit_config(
	source: string,
	origin: string,
	profile: SvelteKitProfile,
	config_path: string,
): string {
	const origin_property = profile.supports_paths_origin
		? `origin: ${JSON.stringify(origin)},`
		: "";
	const rendered = source.replace(paths_origin_placeholder, origin_property);

	if (rendered === source) {
		throw new Error(
			`Missing SvelteKit fixture paths-origin placeholder in ${config_path} for ${profile.name}.`,
		);
	}

	return rendered;
}
