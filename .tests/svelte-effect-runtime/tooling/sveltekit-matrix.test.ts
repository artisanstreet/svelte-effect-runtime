import {
	resolve_sveltekit_profiles,
	sveltekit_profiles,
} from "../consumer/harness/sveltekit-profiles.ts";
import { render_fixture_sveltekit_config } from "../consumer/harness/fixture-config.ts";
import { expect, test } from "vitest";

test("supported SvelteKit profiles select peer-compatible adapter generations", () => {
	expect(sveltekit_profiles).toEqual([
		{
			name: "kit-2-stable",
			adapter_node_version: "5.5.7",
			supports_paths_origin: false,
			sveltekit_version: "2.69.3",
		},
		{
			name: "kit-3-primary",
			adapter_node_version: "6.0.0-next.3",
			adapter_patch_name: "@sveltejs__adapter-node@6.0.0-next.3.patch",
			supports_paths_origin: true,
			sveltekit_version: "3.0.0-next.6",
		},
	]);
});

test("all matrix mode resolves every supported profile", () => {
	const profiles = resolve_sveltekit_profiles({ SVELTEKIT_MATRIX: "all" });

	expect(profiles).toEqual(sveltekit_profiles);
});

test.each([
	["2.68.0", "5.5.7"],
	["3.0.0-next.8", "6.0.0-next.3"],
])("custom SvelteKit %s selects adapter-node %s", (sveltekit_version, adapter_node_version) => {
	const [profile] = resolve_sveltekit_profiles({ SVELTEKIT_VERSION: sveltekit_version });

	expect(profile).toMatchObject({ adapter_node_version, sveltekit_version });
});

test("matrix mode rejects an ambiguous version override", () => {
	expect(() =>
		resolve_sveltekit_profiles({
			SVELTEKIT_MATRIX: "all",
			SVELTEKIT_VERSION: "2.69.3",
		}),
	).toThrow("SVELTEKIT_MATRIX cannot be combined");
});

test.each(sveltekit_profiles)("$name renders only supported fixture path options", (profile) => {
	const template = [
		"paths: {",
		'\t__CONFORMANCE_PATHS_ORIGIN__: "__CONFORMANCE_ORIGIN__",',
		"},",
	].join("\n");
	const rendered = render_fixture_sveltekit_config(template, "http://127.0.0.1:4173", profile);

	expect(rendered).not.toContain("__CONFORMANCE_");
	expect(rendered.includes('origin: "http://127.0.0.1:4173",')).toBe(
		profile.supports_paths_origin,
	);
});
