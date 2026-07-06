import { highlights_query, injections_query } from "./tree-sitter/queries.generated.ts";

/**
 * Tree-sitter query strings for SER-aware Svelte tooling.
 *
 * @example
 * ```ts
 * const highlights = tree_sitter.highlights_query;
 * const injections = tree_sitter.injections_query;
 * ```
 *
 * @since 3.2.0
 */
export interface TreeSitterQueryBundle {
	readonly name: string;
	readonly highlights_query: string;
	readonly injections_query: string;
}

/**
 * Query strings that describe SER's extensions for tree-sitter-svelte clients.
 *
 * @example
 * ```ts
 * const highlights = tree_sitter.highlights_query;
 * const injections = tree_sitter.injections_query;
 * ```
 *
 * @since 3.2.0
 */
export const tree_sitter: TreeSitterQueryBundle = {
	name: "svelte-effect-runtime",
	highlights_query,
	injections_query,
};
