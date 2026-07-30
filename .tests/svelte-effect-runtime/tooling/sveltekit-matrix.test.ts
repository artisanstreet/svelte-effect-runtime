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
			generated_tsconfig_specifier: "./.svelte-kit/tsconfig.json",
			supports_explicit_environment: false,
			supports_paths_origin: false,
			supports_subpath_lib_imports: false,
			sveltekit_version: "2.69.3",
		},
		{
			name: "kit-3-primary",
			adapter_node_version: "6.0.0-next.3",
			adapter_output_directory_module: "dir.js",
			generated_tsconfig_specifier: "./.svelte-kit/tsconfig.json",
			supports_explicit_environment: true,
			supports_paths_origin: true,
			supports_subpath_lib_imports: false,
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
	["3.0.0-next.9", "6.0.0-next.4"],
	["3.0.0-next.10", "6.0.0-next.4"],
	["3.0.0-next.11", "6.0.0-next.5"],
	["3.0.0-next.12", "6.0.0-next.6"],
	["3.0.0-next.13", "6.0.0-next.6"],
])("custom SvelteKit %s selects adapter-node %s", (sveltekit_version, adapter_node_version) => {
	const [profile] = resolve_sveltekit_profiles({ SVELTEKIT_VERSION: sveltekit_version }, "linux");

	expect(profile).toMatchObject({ adapter_node_version, sveltekit_version });
});

test.each([
	["3.0.0-next.8", false, "./.svelte-kit/tsconfig.json"],
	["3.0.0-next.9", true, "./.svelte-kit/tsconfig.json"],
	["3.0.0-next.11", true, "./.svelte-kit/tsconfig.json"],
	["3.0.0-next.12", true, "$app/tsconfig"],
	["3.0.0-next.13", true, "$app/tsconfig"],
])(
	"custom SvelteKit %s records the fixture layout that version requires",
	(sveltekit_version, supports_subpath_lib_imports, generated_tsconfig_specifier) => {
		const [profile] = resolve_sveltekit_profiles(
			{ SVELTEKIT_VERSION: sveltekit_version },
			"linux",
		);

		expect(profile).toMatchObject({
			generated_tsconfig_specifier,
			supports_subpath_lib_imports,
		});
	},
);

test.each(["3.x", "3", "2.69", "next"])(
	"a malformed SVELTEKIT_VERSION %s names what the harness accepts",
	(sveltekit_version) => {
		expect(() =>
			resolve_sveltekit_profiles({ SVELTEKIT_VERSION: sveltekit_version }, "linux"),
		).toThrow(`Unsupported SVELTEKIT_VERSION ${sveltekit_version}`);
	},
);

test("a custom SvelteKit prerelease with a fixed adapter drops the Windows defect", () => {
	const [profile] = resolve_sveltekit_profiles({ SVELTEKIT_VERSION: "3.0.0-next.13" }, "win32");

	expect(profile).toMatchObject({ adapter_node_version: "6.0.0-next.6", name: "custom" });
	expect(profile?.unsupported_platforms).toBeUndefined();
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
