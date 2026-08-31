import {
	resolve_sveltekit_profiles,
	sveltekit_profiles,
} from "../consumer/harness/sveltekit-profiles.ts";
import {
	render_fixture_lib_imports,
	render_fixture_sveltekit_config,
} from "../consumer/harness/fixture-config.ts";
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
			requires_explicit_module_extensions: false,
			sveltekit_version: "2.70.2",
		},
		{
			name: "kit-3-primary",
			adapter_node_version: "6.0.0-next.10",
			generated_tsconfig_specifier: "$app/tsconfig",
			supports_explicit_environment: true,
			supports_paths_origin: true,
			supports_subpath_lib_imports: true,
			requires_explicit_module_extensions: true,
			sveltekit_version: "3.0.0-next.25",
		},
	]);
});

test("all matrix mode resolves every supported profile", () => {
	const profiles = resolve_sveltekit_profiles({ SVELTEKIT_MATRIX: "all" }, "linux");

	expect(profiles).toEqual(sveltekit_profiles);
});

test("Windows matrix mode resolves every supported profile since adapter-node 6.0.0-next.8", () => {
	const profiles = resolve_sveltekit_profiles({ SVELTEKIT_MATRIX: "all" }, "win32");

	expect(profiles).toEqual(sveltekit_profiles);
});

test("matrix mode keeps its isolated output layout", () => {
	const environment = { SVELTEKIT_MATRIX: "all" };
	const layout = resolve_conformance_layout(environment);

	expect(layout).toEqual({
		is_matrix: true,
		metadata_path: "matrix.json",
		root_directory: "conformance-matrix",
	});
});

test("Windows defaults to the Kit 3 primary profile", () => {
	const profiles = resolve_sveltekit_profiles({}, "win32");

	expect(profiles).toEqual([sveltekit_profiles[1]]);
});

test("Windows rejects a custom prerelease that pairs with the defective legacy adapter", () => {
	expect(() =>
		resolve_sveltekit_profiles({ SVELTEKIT_VERSION: "3.0.0-next.8" }, "win32"),
	).toThrow(
		"custom is unavailable on win32 because adapter-node 6.0.0-next.3 leaves entry constants unresolved and cannot start; see https://github.com/sveltejs/kit/issues/16365.",
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
	["3.0.0-next.14", "6.0.0-next.7"],
	["3.0.0-next.15", "6.0.0-next.8"],
	["3.0.0-next.17", "6.0.0-next.8"],
	["3.0.0-next.19", "6.0.0-next.9"],
	["3.0.0-next.20", "6.0.0-next.10"],
	["3.0.0-next.21", "6.0.0-next.10"],
	["3.0.0-next.25", "6.0.0-next.10"],
])("custom SvelteKit %s selects adapter-node %s", (sveltekit_version, adapter_node_version) => {
	const [profile] = resolve_sveltekit_profiles({ SVELTEKIT_VERSION: sveltekit_version }, "linux");

	expect(profile).toMatchObject({ adapter_node_version, sveltekit_version });
});

test.each([
	["3.0.0-next.8", false, false, "./.svelte-kit/tsconfig.json"],
	["3.0.0-next.9", true, false, "./.svelte-kit/tsconfig.json"],
	["3.0.0-next.11", true, false, "./.svelte-kit/tsconfig.json"],
	["3.0.0-next.12", true, false, "$app/tsconfig"],
	["3.0.0-next.13", true, false, "$app/tsconfig"],
	["3.0.0-next.19", true, false, "$app/tsconfig"],
	["3.0.0-next.20", true, true, "$app/tsconfig"],
	["3.0.0-next.25", true, true, "$app/tsconfig"],
])(
	"custom SvelteKit %s records the fixture layout that version requires",
	(
		sveltekit_version,
		supports_subpath_lib_imports,
		requires_explicit_module_extensions,
		generated_tsconfig_specifier,
	) => {
		const [profile] = resolve_sveltekit_profiles(
			{ SVELTEKIT_VERSION: sveltekit_version },
			"linux",
		);

		expect(profile).toMatchObject({
			generated_tsconfig_specifier,
			requires_explicit_module_extensions,
			supports_subpath_lib_imports,
		});
	},
);

test.each([
	[
		"2.69.0",
		'import { GetPosts } from "$lib/conformance.remote";',
		'import { GetPosts } from "$lib/conformance.remote";',
	],
	[
		"3.0.0-next.19",
		'import { GetPosts } from "$lib/conformance.remote";',
		'import { GetPosts } from "#lib/conformance.remote";',
	],
	[
		"3.0.0-next.20",
		'import { GetPosts } from "$lib/conformance.remote";',
		'import { GetPosts } from "#lib/conformance.remote.ts";',
	],
	[
		"3.0.0-next.20",
		'import Page from "$lib/components/query-page.svelte";',
		'import Page from "#lib/components/query-page.svelte";',
	],
])(
	"custom SvelteKit %s renders %s onto the supported library specifier",
	(sveltekit_version, source, rendered) => {
		const [profile] = resolve_sveltekit_profiles(
			{ SVELTEKIT_VERSION: sveltekit_version },
			"linux",
		);

		expect(profile).toBeDefined();
		expect(render_fixture_lib_imports(source, profile!)).toBe(rendered);
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
