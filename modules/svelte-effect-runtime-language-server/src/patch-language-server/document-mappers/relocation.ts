import { create_source_map_mapper } from "./source-map.ts";
import { is_invalid_position, OffsetTable } from "./position.ts";
import type { DocumentPosition, Mapper, Relocation } from "../types.ts";

/**
 * Creates a mapper that first consults relocation ranges before falling back
 * to the transform source map.
 *
 * @example
 * ```ts
 * const mapper = create_relocated_source_mapper(source, code, map, ranges, uri);
 * ```
 *
 * @since 2.0.0
 * @param original_code - Source code before the transform.
 * @param transformed_code - Source code after the transform.
 * @param raw_map - Source map returned by the runtime transform.
 * @param relocations - Offset ranges that were moved during the transform.
 * @param source_uri - URI of the original Svelte document.
 * @returns Mapper that translates positions through relocations and maps.
 */
export function create_relocated_source_mapper(
  original_code: string,
  transformed_code: string,
  raw_map: Record<string, unknown>,
  relocations: Array<Relocation>,
  source_uri: string,
): Mapper {
  const source_mapper = create_source_map_mapper(raw_map, source_uri);
  const relocation_mapper = create_relocation_mapper(
    original_code,
    transformed_code,
    relocations,
  );

  if (!relocation_mapper) {
    return source_mapper;
  }

  return {
    getOriginalPosition(generated_position: DocumentPosition) {
      const relocated_position = relocation_mapper.getOriginalPosition(
        generated_position,
      );

      if (!is_invalid_position(relocated_position)) {
        return relocated_position;
      }

      return source_mapper.getOriginalPosition(generated_position);
    },
    getGeneratedPosition(original_position: DocumentPosition) {
      const relocated_position = relocation_mapper.getGeneratedPosition(
        original_position,
      );

      if (!is_invalid_position(relocated_position)) {
        return relocated_position;
      }

      return source_mapper.getGeneratedPosition(original_position);
    },
    isInGenerated(original_position: DocumentPosition) {
      const generated_position = this.getGeneratedPosition(original_position);

      return !is_invalid_position(generated_position);
    },
  };
}

/**
 * Creates a direct position mapper for relocation ranges.
 *
 * @example
 * ```ts
 * const mapper = create_relocation_mapper(source, generated, relocations);
 * ```
 *
 * @since 2.0.0
 * @param original_content - Original text for offset conversion.
 * @param transformed_content - Transformed text for offset conversion.
 * @param relocations - Offset ranges linking original and generated text.
 * @returns Mapper for relocation ranges, or null when no ranges exist.
 */
export function create_relocation_mapper(
  original_content: string,
  transformed_content: string,
  relocations: Array<Relocation>,
): Mapper | null {
  if (relocations.length === 0) {
    return null;
  }

  const original_offsets = new OffsetTable(original_content);
  const transformed_offsets = new OffsetTable(transformed_content);

  return {
    getOriginalPosition(generated_position: DocumentPosition) {
      const generated_offset = transformed_offsets.offsetAt(
        generated_position,
      );
      const relocation = find_relocation(
        relocations,
        generated_offset,
        "generatedStart",
        "generatedEnd",
      );

      if (!relocation) {
        return { line: -1, character: -1 };
      }

      return original_offsets.positionAt(
        map_offset_between_ranges(
          generated_offset,
          relocation.generatedStart,
          relocation.generatedEnd,
          relocation.originalStart,
          relocation.originalEnd,
        ),
      );
    },
    getGeneratedPosition(original_position: DocumentPosition) {
      const original_offset = original_offsets.offsetAt(original_position);
      const relocation = find_relocation(
        relocations,
        original_offset,
        "originalStart",
        "originalEnd",
      );

      if (!relocation) {
        return { line: -1, character: -1 };
      }

      return transformed_offsets.positionAt(
        map_offset_between_ranges(
          original_offset,
          relocation.originalStart,
          relocation.originalEnd,
          relocation.generatedStart,
          relocation.generatedEnd,
        ),
      );
    },
    isInGenerated(original_position: DocumentPosition) {
      return !is_invalid_position(this.getGeneratedPosition(original_position));
    },
  };
}

function find_relocation(
  relocations: Array<Relocation>,
  offset: number,
  start_key: "originalStart" | "generatedStart",
  end_key: "originalEnd" | "generatedEnd",
): Relocation | null {
  let match: Relocation | null = null;

  for (const relocation of relocations) {
    if (offset < relocation[start_key] || offset > relocation[end_key]) {
      continue;
    }

    if (
      !match ||
      relocation[end_key] - relocation[start_key] <
        match[end_key] - match[start_key]
    ) {
      match = relocation;
    }
  }

  return match;
}

function map_offset_between_ranges(
  offset: number,
  source_start: number,
  source_end: number,
  target_start: number,
  target_end: number,
): number {
  if (offset <= source_start) {
    return target_start;
  }

  if (offset >= source_end) {
    return target_end;
  }

  const source_length = Math.max(source_end - source_start, 1);
  const target_length = Math.max(target_end - target_start, 1);
  const relative_offset = Math.min(
    Math.max(offset - source_start, 0),
    source_length - 1,
  );

  return target_start + Math.min(relative_offset, target_length - 1);
}
