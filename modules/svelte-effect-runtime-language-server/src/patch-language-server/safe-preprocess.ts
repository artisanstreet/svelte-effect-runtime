type PreprocessMarkupOptions = {
  content: string;
  filename?: string;
};

type PreprocessMarkupResult = {
  code: string;
  map?: unknown;
  attributes?: Record<string, unknown>;
};

type PreprocessGroup = {
  name: string;
  markup(
    options: PreprocessMarkupOptions,
  ): PreprocessMarkupResult | Promise<PreprocessMarkupResult>;
  [key: string]: unknown;
};

/**
 * Wraps the runtime preprocessor so transform errors cannot terminate the
 * language-server process while a user is typing invalid SER code.
 *
 * @example
 * ```ts
 * patch_svelte_compiler_path(create_safe_preprocess(runtime.preprocess));
 * ```
 *
 * @since 2.4.0
 * @param create_preprocess - Factory that creates the runtime Svelte
 *   preprocessor group.
 * @returns A preprocessor factory that falls back to the original component
 *   source when the runtime preprocessor throws.
 */
export function create_safe_preprocess(
  create_preprocess: () => PreprocessGroup,
): () => PreprocessGroup {
  return () => {
    const group = create_preprocess();

    return {
      ...group,
      async markup(options: PreprocessMarkupOptions) {
        try {
          return await group.markup(options);
        } catch {
          return { code: options.content };
        }
      },
    };
  };
}
