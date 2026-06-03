import type { MDXComponents } from "mdx/types";

import default_mdx_components from "fumadocs-ui/mdx";

export function useMDXComponents(
  components?: MDXComponents,
): MDXComponents {
  return {
    ...default_mdx_components,
    ...components,
  };
}

export const mdx_components = useMDXComponents();

declare global {
  type MDXProvidedComponents = ReturnType<typeof useMDXComponents>;
}
