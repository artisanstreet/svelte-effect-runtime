import {
	resolve_sveltekit_profiles,
	sveltekit_profiles,
} from "../consumer/harness/sveltekit-profiles.ts";
import { render_fixture_sveltekit_config } from "../consumer/harness/fixture-config.ts";
import { resolve_conformance_layout } from "../consumer/harness/prepare.ts";
import { expect, test } from "vitest";

test("supported SvelteKit profiles select peer-compatible adapter generations", () => {
	expect(sveltekit_profiles).toEqual([
		{
			name: "kit-2-stable",
			adapter_node_version: "5.5.7",
			supports_explicit_environment: false,
			supports_paths_origin: false,
			sveltekit_version: "2.69.3",
		},
		{
			name: "kit-3-primary",
			adapter_node_version: "6.0.0-next.3",
			adapter_output_directory_module: "dir.js",
			supports_explicit_environment: true,
			supports_paths_origin: true,
			sveltekit_version: "3.0.0-next.8",
			unsupported_platforms: {
				win32: {
					issue: "https://github.com/sveltejs/kit/issues/16365",
					reason: "adapter-node 6.0.0-next.3 leaves entry constants unresolved and cannot start",
				},
			},
		},
	]);
});

test("all matrix mode resolves every supported profile", () => {
	const profiles = resolve_sveltekit_profiles({ SVELTEKIT_MATRIX: "all" }, "linux");

	expect(profiles).toEqual(sveltekit_profiles);
});

test("Windows matrix mode excludes the upstream-broken Kit 3 Node profile", () => {
	const profiles = resolve_sveltekit_profiles({ SVELTEKIT_MATRIX: "all" }, "win32");

	expect(profiles).toEqual([sveltekit_profiles[0]]);
});

test("matrix output remains isolated when the platform supports one profile", () => {
	const environment = { SVELTEKIT_MATRIX: "all" };
	const profiles = resolve_sveltekit_profiles(environment, "win32");
	const layout = resolve_conformance_layout(environment);

	expect(profiles).toHaveLength(1);
	expect(layout).toEqual({
		is_matrix: true,
		metadata_path: "matrix.json",
		root_directory: "conformance-matrix",
	});
});

test("Windows defaults to the production-capable Kit 2 profile", () => {
	const profiles = resolve_sveltekit_profiles({}, "win32");

	expect(profiles).toEqual([sveltekit_profiles[0]]);
});

test.each([
	[{ SVELTEKIT_PROFILE: "kit-3-primary" }, "kit-3-primary"],
	[{ SVELTEKIT_VERSION: "3.0.0-next.8" }, "custom"],
])("Windows rejects an explicit unsupported Kit 3 selection for %s", (environment, profile) => {
	expect(() => resolve_sveltekit_profiles(environment, "win32")).toThrow(
		`${profile} is unavailable on win32 because adapter-node 6.0.0-next.3 leaves entry constants unresolved and cannot start; see https://github.com/sveltejs/kit/issues/16365.`,
	);
});

test.each([
	["2.68.0", "5.5.7"],
	["3.0.0-next.8", "6.0.0-next.3"],
])("custom SvelteKit %s selects adapter-node %s", (sveltekit_version, adapter_node_version) => {
	const [profile] = resolve_sveltekit_profiles({ SVELTEKIT_VERSION: sveltekit_version }, "linux");

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
	const rendered = render_fixture_sveltekit_config(
		template,
		"http://127.0.0.1:4173",
		profile,
		"/fixtures/vite.config.ts",
	);

	expect(rendered).not.toContain("__CONFORMANCE_");
	expect(rendered.includes('origin: "http://127.0.0.1:4173",')).toBe(
		profile.supports_paths_origin,
	);
});

test("fixture rendering identifies a missing marker by profile and config", () => {
	const [profile] = sveltekit_profiles;

	expect(() =>
		render_fixture_sveltekit_config(
			"paths: {},",
			"http://127.0.0.1:4173",
			profile,
			"/applications/native/vite.config.ts",
		),
	).toThrow(
		"Missing SvelteKit fixture paths-origin placeholder in /applications/native/vite.config.ts for kit-2-stable.",
	);
});
