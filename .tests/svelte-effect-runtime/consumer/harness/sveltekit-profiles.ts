export type SvelteKitProfileName = "kit-2-stable" | "kit-3-primary";

export type SvelteKitProfile = {
	readonly name: SvelteKitProfileName | "custom";
	readonly adapter_node_version: string;
	readonly adapter_patch_name?: string;
	readonly supports_paths_origin: boolean;
	readonly sveltekit_version: string;
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
	adapter_patch_name: "@sveltejs__adapter-node@6.0.0-next.3.patch",
	supports_paths_origin: true,
	sveltekit_version: "3.0.0-next.6",
};

export const sveltekit_profiles = [kit_2_stable, kit_3_primary] as const;

export function resolve_sveltekit_profiles(
	environment: NodeJS.ProcessEnv,
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
		return sveltekit_profiles;
	}

	if (requested_version) {
		return [make_custom_profile(requested_version)];
	}

	if (!requested_profile) {
		return [kit_3_primary];
	}

	const profile = sveltekit_profiles.find(({ name }) => name === requested_profile);

	if (!profile) {
		throw new Error(
			`Unsupported SVELTEKIT_PROFILE ${requested_profile}; expected ${sveltekit_profiles.map(({ name }) => name).join(" or ")}.`,
		);
	}

	return [profile];
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
