import type { SvelteKitProfile } from "./sveltekit-profiles.ts";

const paths_origin_placeholder = '__CONFORMANCE_PATHS_ORIGIN__: "__CONFORMANCE_ORIGIN__",';

export function render_fixture_sveltekit_config(
	source: string,
	origin: string,
	profile: SvelteKitProfile,
): string {
	const origin_property = profile.supports_paths_origin
		? `origin: ${JSON.stringify(origin)},`
		: "";
	const rendered = source.replace(paths_origin_placeholder, origin_property);

	if (rendered === source) {
		throw new Error("Missing SvelteKit fixture paths-origin placeholder.");
	}

	return rendered;
}
