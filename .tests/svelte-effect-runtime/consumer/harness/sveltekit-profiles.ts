export type SvelteKitProfileName = "kit-2-stable" | "kit-3-primary";

export type SvelteKitPlatformDefect = {
	readonly issue: string;
	readonly reason: string;
};

export type SvelteKitProfile = {
	readonly name: SvelteKitProfileName | "custom";
	readonly adapter_node_version: string;
	readonly adapter_output_directory_module?: string;
	readonly supports_paths_origin: boolean;
	readonly sveltekit_version: string;
	readonly unsupported_platforms?: Partial<
		Readonly<Record<NodeJS.Platform, SvelteKitPlatformDefect>>
	>;
};

const kit_2_stable: SvelteKitProfile = {
	name: "kit-2-stable",
	adapter_node_version: "5.5.7",
	supports_paths_origin: false,
	sveltekit_version: "2.69.3",
};

const kit_3_primary: SvelteKitProfile = {
	name: "kit-3-primary",
	adapter_node_version: "6.0.0-next.3",
	adapter_output_directory_module: "dir.js",
	supports_paths_origin: true,
	sveltekit_version: "3.0.0-next.8",
	unsupported_platforms: {
		win32: {
			issue: "https://github.com/sveltejs/kit/issues/16365",
			reason: "adapter-node 6.0.0-next.3 leaves entry constants unresolved and cannot start",
		},
	},
};

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
	if (sveltekit_version.startsWith("2.")) {
		return {
			...kit_2_stable,
			name: "custom",
			sveltekit_version,
		};
	}

	if (sveltekit_version.startsWith("3.")) {
		return {
			...kit_3_primary,
			name: "custom",
			sveltekit_version,
		};
	}

	throw new Error(
		`Unsupported SVELTEKIT_VERSION ${sveltekit_version}; expected an exact 2.x or 3.x version.`,
	);
}
