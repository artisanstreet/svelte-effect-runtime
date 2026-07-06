/**
 * Generates the checked-in tree-sitter query module from normalized source
 * queries.
 *
 * @example
 * ```ts
 * const code = generate_tree_sitter_query_module(
 *   "(yield_expression) @keyword.control.yield",
 *   "((expression) @injection.content)",
 * );
 * ```
 *
 * @since 3.4.0
 * @param highlights_query - Normalized contents of the tree-sitter highlights
 *   query file, emitted as the `highlights_query` export.
 * @param injections_query - Normalized contents of the tree-sitter injections
 *   query file, emitted as the `injections_query` export.
 * @returns TypeScript module source that exports both query strings as inert
 *   serialized data.
 */
export function generate_tree_sitter_query_module(
	highlights_query: string,
	injections_query: string,
): string {
	const serialized_highlights_query = JSON.stringify(highlights_query);
	const serialized_injections_query = JSON.stringify(injections_query);

	return [
		`export const highlights_query = ${serialized_highlights_query};`,
		``,
		`export const injections_query = ${serialized_injections_query};`,
		``,
	].join("\n");
}
