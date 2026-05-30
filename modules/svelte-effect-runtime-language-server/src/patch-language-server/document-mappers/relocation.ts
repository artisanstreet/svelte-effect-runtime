// deno-lint-ignore-file no-explicit-any
import { create_source_map_mapper } from "./source-map.ts";
import { is_invalid_position, OffsetTable } from "./position.ts";
import type { Mapper, Relocation } from "../types.ts";

export function create_relocated_source_mapper(
  originalCode: string,
  transformedCode: string,
  rawMap: Record<string, unknown>,
  relocations: Array<Relocation>,
  sourceUri: string,
): Mapper {
  const sourceMapper = create_source_map_mapper(rawMap, sourceUri);
  const relocationMapper = create_relocation_mapper(
    originalCode,
    transformedCode,
    relocations,
  );

  if (!relocationMapper) {
    return sourceMapper;
  }

  return {
    getOriginalPosition(generatedPosition: any) {
      const relocatedPosition = relocationMapper.getOriginalPosition(
        generatedPosition,
      );

      if (!is_invalid_position(relocatedPosition)) {
        return relocatedPosition;
      }

      return sourceMapper.getOriginalPosition(generatedPosition);
    },
    getGeneratedPosition(originalPosition: any) {
      const relocatedPosition = relocationMapper.getGeneratedPosition(
        originalPosition,
      );

      if (!is_invalid_position(relocatedPosition)) {
        return relocatedPosition;
      }

      return sourceMapper.getGeneratedPosition(originalPosition);
    },
    isInGenerated(originalPosition: any) {
      const generatedPosition = this.getGeneratedPosition(originalPosition);
      return !is_invalid_position(generatedPosition);
    },
  };
}

export function create_relocation_mapper(
  originalContent: string,
  transformedContent: string,
  relocations: Array<Relocation>,
): Mapper | null {
  if (relocations.length === 0) {
    return null;
  }

  const originalOffsets = new OffsetTable(originalContent);
  const transformedOffsets = new OffsetTable(transformedContent);

  return {
    getOriginalPosition(generatedPosition: any) {
      const generatedOffset = transformedOffsets.offsetAt(generatedPosition);
      const relocation = find_relocation(
        relocations,
        generatedOffset,
        "generatedStart",
        "generatedEnd",
      );

      if (!relocation) {
        return { line: -1, character: -1 };
      }

      return originalOffsets.positionAt(
        map_offset_between_ranges(
          generatedOffset,
          relocation.generatedStart,
          relocation.generatedEnd,
          relocation.originalStart,
          relocation.originalEnd,
        ),
      );
    },
    getGeneratedPosition(originalPosition: any) {
      const originalOffset = originalOffsets.offsetAt(originalPosition);
      const relocation = find_relocation(
        relocations,
        originalOffset,
        "originalStart",
        "originalEnd",
      );

      if (!relocation) {
        return { line: -1, character: -1 };
      }

      return transformedOffsets.positionAt(
        map_offset_between_ranges(
          originalOffset,
          relocation.originalStart,
          relocation.originalEnd,
          relocation.generatedStart,
          relocation.generatedEnd,
        ),
      );
    },
    isInGenerated(originalPosition: any) {
      return !is_invalid_position(this.getGeneratedPosition(originalPosition));
    },
  };
}

function find_relocation(
  relocations: Array<Relocation>,
  offset: number,
  startKey: "originalStart" | "generatedStart",
  endKey: "originalEnd" | "generatedEnd",
) {
  let match: Relocation | null = null;

  for (const relocation of relocations) {
    if (offset < relocation[startKey] || offset > relocation[endKey]) {
      continue;
    }

    if (
      !match ||
      relocation[endKey] - relocation[startKey] <
        match[endKey] - match[startKey]
    ) {
      match = relocation;
    }
  }

  return match;
}

function map_offset_between_ranges(
  offset: number,
  sourceStart: number,
  sourceEnd: number,
  targetStart: number,
  targetEnd: number,
) {
  if (offset <= sourceStart) {
    return targetStart;
  }

  if (offset >= sourceEnd) {
    return targetEnd;
  }

  const sourceLength = Math.max(sourceEnd - sourceStart, 1);
  const targetLength = Math.max(targetEnd - targetStart, 1);
  const relativeOffset = Math.min(
    Math.max(offset - sourceStart, 0),
    sourceLength - 1,
  );

  return targetStart + Math.min(relativeOffset, targetLength - 1);
}
