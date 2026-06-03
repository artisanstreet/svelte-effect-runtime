import { TraceMap } from "@jridgewell/trace-mapping";

import { SourceMapDocumentMapper } from "../svelte-internals.ts";
import type { Mapper } from "../types.ts";

/**
 * Creates a Svelte language-server source-map mapper from a raw transform map.
 *
 * @example
 * ```ts
 * const mapper = create_source_map_mapper(map, document.uri);
 * ```
 *
 * @since 2.0.0
 * @param raw_map - Source map returned by the runtime transform.
 * @param source_uri - URI of the original Svelte document.
 * @returns Mapper that translates between transformed and original positions.
 */
export function create_source_map_mapper(
  raw_map: Record<string, unknown>,
  source_uri: string,
): Mapper {
  const trace_map_input = {
    ...raw_map,
    sources: [source_uri],
  } as ConstructorParameters<typeof TraceMap>[0];

  return new SourceMapDocumentMapper(
    new TraceMap(trace_map_input),
    source_uri,
  ) as Mapper;
}
