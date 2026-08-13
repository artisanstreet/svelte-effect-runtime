import type { SvelteKitProfile } from "./sveltekit-profiles.ts";

const paths_origin_placeholder = '__CONFORMANCE_PATHS_ORIGIN__: "__CONFORMANCE_ORIGIN__",';

/** Fixture sources address the library root through SvelteKit 2's alias. */
const lib_specifier_pattern = /(["'])\$lib\/([^"']+)\1/g;

/** Subpath import that replaces the alias on SvelteKit 3.0.0-next.9 and later. */
export const lib_subpath_import = "#lib";

export const lib_subpath_imports: Readonly<Record<string, string>> = {
	[`${lib_subpath_import}/*`]: "./src/lib/*",
};

/** Extensions fixture sources already spell out in library specifiers. */
const explicit_specifier_extensions = [".js", ".svelte", ".ts"];

/**
 * Rewrites a fixture source onto the library specifier the profile supports.
 * Fixture library modules are TypeScript except for spelled-out `.svelte`
 * components, so profiles that resolve subpath imports Node-style get a `.ts`
 * extension appended to extensionless specifiers.
 *
 * @param source - Fixture file contents.
 * @param profile - Compatibility profile being prepared.
 * @returns The source addressed through the supported library specifier.
 */
export function render_fixture_lib_imports(source: string, profile: SvelteKitProfile): string {
	if (!profile.supports_subpath_lib_imports) {
		return source;
	}

	return source.replace(lib_specifier_pattern, (_match, quote: string, module_path: string) => {
		const needs_extension =
			profile.requires_explicit_module_extensions &&
			!explicit_specifier_extensions.some((extension) => module_path.endsWith(extension));
		const rendered_path = needs_extension ? `${module_path}.ts` : module_path;

		return `${quote}${lib_subpath_import}/${rendered_path}${quote}`;
	});
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
