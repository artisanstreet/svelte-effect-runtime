import type MagicString from "magic-string";
import type ts from "typescript";

export function create_source_map(magic: MagicString, filename: string): Record<string, unknown> {
	const map = magic.generateMap({
		hires: true,
		includeContent: true,
		source: filename,
	});

	return map as unknown as Record<string, unknown>;
}

export function slice(content: string, node: ts.Node): string {
	return content.slice(node.getFullStart(), node.end);
}

export function slice_start(content: string, node: ts.Node): string {
	return content.slice(node.getStart(), node.end);
}
