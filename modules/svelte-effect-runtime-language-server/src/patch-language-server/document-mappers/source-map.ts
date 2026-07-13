import { TraceMap } from "@jridgewell/trace-mapping";
import type { Mapper } from "../types.ts";

type SourceMapDocumentMapperConstructor = new (trace_map: TraceMap, source_uri: string) => Mapper;

/**
 * Creates a Svelte language-server source-map mapper from a raw transform map.
 *
 * @example
 * ```ts
 * const mapper = create_source_map_mapper(
 * 	map,
 * 	document.uri,
 * 	internals.source_map_document_mapper,
 * );
 * ```
 *
 * @since 2.0.0
 * @param raw_map - Source map returned by the runtime transform.
 * @param source_uri - URI of the original Svelte document.
 * @param SourceMapDocumentMapper - Private Svelte language-server mapper
 *   constructor loaded by the bootstrap layer.
 * @returns Mapper that translates between transformed and original positions.
 */
export function create_source_map_mapper(
	raw_map: Record<string, unknown>,
	source_uri: string,
	SourceMapDocumentMapper: SourceMapDocumentMapperConstructor,
): Mapper {
	const trace_map_input = {
		...raw_map,
		sources: [source_uri],
	} as ConstructorParameters<typeof TraceMap>[0];

	return new SourceMapDocumentMapper(new TraceMap(trace_map_input), source_uri) as Mapper;
}
