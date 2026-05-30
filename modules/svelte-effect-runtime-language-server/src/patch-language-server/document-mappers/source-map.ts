// deno-lint-ignore-file no-explicit-any
import { TraceMap } from "@jridgewell/trace-mapping";

import { SourceMapDocumentMapper } from "../svelte-internals.ts";
import type { Mapper } from "../types.ts";

export function create_source_map_mapper(
  rawMap: Record<string, unknown>,
  sourceUri: string,
) {
  return new SourceMapDocumentMapper(
    new TraceMap({
      ...(rawMap as any),
      sources: [sourceUri],
    } as any),
    sourceUri,
  ) as Mapper;
}
