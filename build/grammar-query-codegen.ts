export function generate_tree_sitter_query_module(
	highlights_query: string,
	injections_query: string,
): string {
	const serialized_highlights_query = serialize_typescript_string(highlights_query);
	const serialized_injections_query = serialize_typescript_string(injections_query);

	return [
		`export const highlights_query =\n\t${serialized_highlights_query};`,
		``,
		`export const injections_query =\n\t${serialized_injections_query};`,
		``,
	].join("\n");
}

function serialize_typescript_string(value: string): string {
	const json = JSON.stringify(value);
	const content = json
		.slice(1, -1)
		.replaceAll("'", "\\'")
		.replaceAll('\\"', '"')
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");

	return `'${content}'`;
}
