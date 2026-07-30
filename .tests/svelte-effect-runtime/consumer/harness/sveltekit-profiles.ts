import { gte, valid } from "semver";

export type SvelteKitProfileName = "kit-2-stable" | "kit-3-primary";

export type SvelteKitPlatformDefect = {
	readonly issue: string;
	readonly reason: string;
};

export type SvelteKitProfile = {
	readonly name: SvelteKitProfileName | "custom";
	readonly adapter_node_version: string;
	readonly adapter_output_directory_module?: string;
	/** Specifier the fixture tsconfig inherits SvelteKit's generated options from. */
	readonly generated_tsconfig_specifier: string;
	readonly supports_explicit_environment: boolean;
	readonly supports_paths_origin: boolean;
	/** SvelteKit 3 replaced the `$lib` alias with package.json subpath imports. */
	readonly supports_subpath_lib_imports: boolean;
	readonly sveltekit_version: string;
	readonly unsupported_platforms?: Partial<
		Readonly<Record<NodeJS.Platform, SvelteKitPlatformDefect>>
	>;
};

const kit_3_adapter_directory_module = "dir.js";

const legacy_generated_tsconfig = "./.svelte-kit/tsconfig.json";

/** SvelteKit 3.0.0-next.12 moved the generated tsconfig into `node_modules/$app`. */
const app_generated_tsconfig = "$app/tsconfig";

const kit_2_stable: SvelteKitProfile = {
	name: "kit-2-stable",
	adapter_node_version: "5.5.7",
	generated_tsconfig_specifier: legacy_generated_tsconfig,
	supports_explicit_environment: false,
	supports_paths_origin: false,
	supports_subpath_lib_imports: false,
	sveltekit_version: "2.69.3",
};

const kit_3_primary: SvelteKitProfile = {
	name: "kit-3-primary",
	adapter_node_version: "6.0.0-next.3",
	generated_tsconfig_specifier: legacy_generated_tsconfig,
	supports_explicit_environment: true,
	adapter_output_directory_module: "dir.js",
	supports_paths_origin: true,
	supports_subpath_lib_imports: false,
	sveltekit_version: "3.0.0-next.8",
	unsupported_platforms: {
		win32: {
			issue: "https://github.com/sveltejs/kit/issues/16365",
			reason: "adapter-node 6.0.0-next.3 leaves entry constants unresolved and cannot start",
		},
	},
};

/**
 * SvelteKit 3 prereleases ship breaking application-layout changes between
 * adapter releases, so a custom version pins the adapter it was published
 * alongside and records the fixture shape that version requires.
 */
const kit_3_prerelease_steps = [
	{ adapter_node_version: "6.0.0-next.6", sveltekit_version: "3.0.0-next.12" },
	{ adapter_node_version: "6.0.0-next.5", sveltekit_version: "3.0.0-next.11" },
	{ adapter_node_version: "6.0.0-next.4", sveltekit_version: "3.0.0-next.9" },
] as const;

export const sveltekit_profiles = [kit_2_stable, kit_3_primary] as const;

export function resolve_sveltekit_profiles(
	environment: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
): ReadonlyArray<SvelteKitProfile> {
	const requested_matrix = environment.SVELTEKIT_MATRIX;
	const requested_profile = environment.SVELTEKIT_PROFILE;
	const requested_version = environment.SVELTEKIT_VERSION;

	if (requested_matrix && requested_matrix !== "all") {
		throw new Error(`Unsupported SVELTEKIT_MATRIX ${requested_matrix}; expected all.`);
	}

	if (requested_matrix && (requested_profile || requested_version)) {
		throw new Error(
			"SVELTEKIT_MATRIX cannot be combined with SVELTEKIT_PROFILE or SVELTEKIT_VERSION.",
		);
	}

	if (requested_matrix === "all") {
		const profiles = sveltekit_profiles.filter(
			(profile) => !get_platform_defect(profile, platform),
		);

		return profiles;
	}

	if (requested_version) {
		const profile = make_custom_profile(requested_version);

		assert_platform_support(profile, platform);

		return [profile];
	}

	if (!requested_profile) {
		const profile = [...sveltekit_profiles]
			.reverse()
			.find((candidate) => !get_platform_defect(candidate, platform));

		if (!profile) {
			throw new Error(`No SvelteKit conformance profile is available on ${platform}.`);
		}

		return [profile];
	}

	const profile = sveltekit_profiles.find(({ name }) => name === requested_profile);

	if (!profile) {
		throw new Error(
			`Unsupported SVELTEKIT_PROFILE ${requested_profile}; expected ${sveltekit_profiles.map(({ name }) => name).join(" or ")}.`,
		);
	}

	assert_platform_support(profile, platform);

	return [profile];
}

function assert_platform_support(profile: SvelteKitProfile, platform: NodeJS.Platform): void {
	const defect = get_platform_defect(profile, platform);

	if (!defect) {
		return;
	}

	throw new Error(
		`${profile.name} is unavailable on ${platform} because ${defect.reason}; see ${defect.issue}.`,
	);
}

function get_platform_defect(
	profile: SvelteKitProfile,
	platform: NodeJS.Platform,
): SvelteKitPlatformDefect | undefined {
	return profile.unsupported_platforms?.[platform];
}

function make_custom_profile(sveltekit_version: string): SvelteKitProfile {
	/**
	 * Reject a malformed version before comparing it. `semver` throws its own
	 * `Invalid Version` error, which says nothing about what this harness
	 * accepts.
	 */
	if (!valid(sveltekit_version)) {
		throw new Error(
			`Unsupported SVELTEKIT_VERSION ${sveltekit_version}; expected an exact 2.x or 3.x version.`,
		);
	}

	if (sveltekit_version.startsWith("2.")) {
		return {
			...kit_2_stable,
			name: "custom",
			sveltekit_version,
		};
	}

	if (sveltekit_version.startsWith("3.")) {
		const step = kit_3_prerelease_steps.find((candidate) =>
			gte(sveltekit_version, candidate.sveltekit_version),
		);
		const adapter_node_version =
			step?.adapter_node_version ?? kit_3_primary.adapter_node_version;
		const platform_defects =
			adapter_node_version === kit_3_primary.adapter_node_version
				? { unsupported_platforms: kit_3_primary.unsupported_platforms }
				: {};

		/**
		 * adapter-node 6.0.0-next.4 bundles the static directory module into a
		 * hashed chunk, so only the release that emits `dir.js` is asserted by
		 * name.
		 */
		const directory_module =
			adapter_node_version === kit_3_primary.adapter_node_version
				? { adapter_output_directory_module: kit_3_adapter_directory_module }
				: {};

		return {
			name: "custom",
			adapter_node_version,
			...directory_module,
			generated_tsconfig_specifier: gte(sveltekit_version, "3.0.0-next.12")
				? app_generated_tsconfig
				: legacy_generated_tsconfig,
			supports_explicit_environment: kit_3_primary.supports_explicit_environment,
			supports_paths_origin: kit_3_primary.supports_paths_origin,
			supports_subpath_lib_imports: gte(sveltekit_version, "3.0.0-next.9"),
			sveltekit_version,
			...platform_defects,
		};
	}

	throw new Error(
		`Unsupported SVELTEKIT_VERSION ${sveltekit_version}; expected an exact 2.x or 3.x version.`,
	);
}
