/**
 * Builds initialization options shared by direct and delegated language clients.
 *
 * @example
 * ```ts
 * const options = create_initialization_options();
 * ```
 *
 * @since 2.0.0
 * @returns Language-server initialization options.
 */
export function create_initialization_options(): Record<string, unknown> {
	const language_config = {
		inlayHints: {
			parameterNames: {
				enabled: "all",
				suppressWhenArgumentMatchesName: false,
			},
			parameterTypes: {
				enabled: true,
			},
			variableTypes: {
				enabled: true,
				suppressWhenTypeMatchesName: false,
			},
			propertyDeclarationTypes: {
				enabled: true,
			},
			functionLikeReturnTypes: {
				enabled: true,
			},
			enumMemberValues: {
				enabled: true,
			},
		},
	};

	return {
		provideFormatter: true,
		dontFilterIncompleteCompletions: true,
		configuration: {
			javascript: language_config,
			typescript: language_config,
		},
	};
}
