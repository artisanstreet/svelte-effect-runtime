import { TraceMap } from "@jridgewell/trace-mapping";
import type { Mapper } from "../types.ts";

type SourceMapDocumentMapperConstructor = new (trace_map: TraceMap, source_uri: string) => Mapper;

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
