import type MagicString from "magic-string";
import type ts from "typescript";

/**
 * Creates a source map from transformed script back to the original block.
 *
 * @example
 * ```ts
 * const map = create_source_map(magic, "Counter.svelte");
 * ```
 *
 * @since 2.0.0
 * @param magic - MagicString instance holding the transformed source.
 * @param filename - Source filename used for the source map entry.
 * @returns A plain source map object.
 */
export function create_source_map(magic: MagicString, filename: string): Record<string, unknown> {
	const map = magic.generateMap({
		hires: true,
		includeContent: true,
		source: filename,
	});

	return map as unknown as Record<string, unknown>;
}

/**
 * Slices a substring matching a node's full source range.
 *
 * @example
 * ```ts
 * const text = slice(source, statement);
 * ```
 *
 * @since 2.0.0
 * @param content - Original source text.
 * @param node - AST node whose full range should be extracted.
 * @returns Source text including leading trivia.
 */
export function slice(content: string, node: ts.Node): string {
	return content.slice(node.getFullStart(), node.end);
}

/**
 * Slices a substring matching a node's source range without leading trivia.
 *
 * @example
 * ```ts
 * const expression = slice_start(source, initializer);
 * ```
 *
 * @since 2.0.0
 * @param content - Original source text.
 * @param node - AST node whose non-trivia range should be extracted.
 * @returns Source text excluding leading trivia.
 */
export function slice_start(content: string, node: ts.Node): string {
	return content.slice(node.getStart(), node.end);
}
