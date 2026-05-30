import { FragmentMapper } from "../svelte-internals.ts";
import { create_relocation_mapper } from "./relocation.ts";
import { create_source_map_mapper } from "./source-map.ts";
import { is_invalid_position } from "./position.ts";
import type {
  DocumentPosition,
  FragmentTagInfo,
  Mapper,
  Relocation,
} from "../types.ts";

/**
 * Creates a mapper for script content nested inside a full Svelte document.
 *
 * @example
 * ```ts
 * const mapper = create_script_content_mapper(source, code, original, next, map, [], full, uri);
 * ```
 *
 * @since 2.0.0
 * @param original_code - Full original Svelte document text.
 * @param transformed_code - Full transformed Svelte document text.
 * @param original_tag_info - Script tag metadata before transformation.
 * @param transformed_tag_info - Script tag metadata after transformation.
 * @param raw_map - Source map for the transformed script content.
 * @param relocations - Relocation ranges within the script content.
 * @param full_document_mapper - Fallback mapper for positions outside script.
 * @param source_uri - URI of the original Svelte document.
 * @returns Mapper that translates script positions through nested fragment maps.
 */
export function create_script_content_mapper(
  original_code: string,
  transformed_code: string,
  original_tag_info: FragmentTagInfo,
  transformed_tag_info: FragmentTagInfo,
  raw_map: Record<string, unknown>,
  relocations: Array<Relocation>,
  full_document_mapper: Mapper,
  source_uri: string,
): Mapper {
  const original_fragment_mapper = new FragmentMapper(
    original_code,
    original_tag_info,
    source_uri,
  ) as Mapper;
  const transformed_fragment_mapper = new FragmentMapper(
    transformed_code,
    transformed_tag_info,
    source_uri,
  ) as Mapper;
  const source_mapper = create_source_map_mapper(raw_map, source_uri);
  const relocation_mapper = create_relocation_mapper(
    original_tag_info.content,
    transformed_tag_info.content,
    relocations,
  );

  return {
    getOriginalPosition(generated_position: DocumentPosition) {
      if (!transformed_fragment_mapper.isInGenerated(generated_position)) {
        return full_document_mapper.getOriginalPosition(generated_position);
      }

      const position_in_transformed_fragment = transformed_fragment_mapper
        .getGeneratedPosition(generated_position);

      if (is_invalid_position(position_in_transformed_fragment)) {
        return position_in_transformed_fragment;
      }

      const relocated_original_position = relocation_mapper
        ?.getOriginalPosition(
          position_in_transformed_fragment,
        );

      if (
        relocated_original_position &&
        !is_invalid_position(relocated_original_position)
      ) {
        return original_fragment_mapper.getOriginalPosition(
          relocated_original_position,
        );
      }

      const position_in_original_fragment = source_mapper.getOriginalPosition(
        position_in_transformed_fragment,
      );

      if (is_invalid_position(position_in_original_fragment)) {
        return position_in_original_fragment;
      }

      return original_fragment_mapper.getOriginalPosition(
        position_in_original_fragment,
      );
    },
    getGeneratedPosition(original_position: DocumentPosition) {
      if (!original_fragment_mapper.isInGenerated(original_position)) {
        return full_document_mapper.getGeneratedPosition(original_position);
      }

      const position_in_original_fragment = original_fragment_mapper
        .getGeneratedPosition(original_position);

      if (is_invalid_position(position_in_original_fragment)) {
        return position_in_original_fragment;
      }

      const relocated_generated_position = relocation_mapper
        ?.getGeneratedPosition(
          position_in_original_fragment,
        );

      if (
        relocated_generated_position &&
        !is_invalid_position(relocated_generated_position)
      ) {
        return transformed_fragment_mapper.getOriginalPosition(
          relocated_generated_position,
        );
      }

      const position_in_transformed_fragment = source_mapper
        .getGeneratedPosition(
          position_in_original_fragment,
        );

      if (is_invalid_position(position_in_transformed_fragment)) {
        return position_in_transformed_fragment;
      }

      return transformed_fragment_mapper.getOriginalPosition(
        position_in_transformed_fragment,
      );
    },
    isInGenerated(original_position: DocumentPosition) {
      const generated_position = this.getGeneratedPosition(original_position);

      return !is_invalid_position(generated_position);
    },
  };
}
