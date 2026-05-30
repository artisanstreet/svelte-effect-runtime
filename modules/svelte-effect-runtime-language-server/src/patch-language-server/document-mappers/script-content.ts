// deno-lint-ignore-file no-explicit-any
import { FragmentMapper } from "../svelte-internals.ts";
import { create_relocation_mapper } from "./relocation.ts";
import { create_source_map_mapper } from "./source-map.ts";
import { is_invalid_position } from "./position.ts";
import type { Mapper, Relocation } from "../types.ts";

export function create_script_content_mapper(
  originalCode: string,
  transformedCode: string,
  originalTagInfo: any,
  transformedTagInfo: any,
  rawMap: Record<string, unknown>,
  relocations: Array<Relocation>,
  fullDocumentMapper: Mapper,
  sourceUri: string,
): Mapper {
  const originalFragmentMapper = new FragmentMapper(
    originalCode,
    originalTagInfo,
    sourceUri,
  ) as Mapper;
  const transformedFragmentMapper = new FragmentMapper(
    transformedCode,
    transformedTagInfo,
    sourceUri,
  ) as Mapper;
  const sourceMapper = create_source_map_mapper(rawMap, sourceUri);
  const relocationMapper = create_relocation_mapper(
    originalTagInfo.content,
    transformedTagInfo.content,
    relocations,
  );

  return {
    getOriginalPosition(generatedPosition: any) {
      if (!transformedFragmentMapper.isInGenerated(generatedPosition)) {
        return fullDocumentMapper.getOriginalPosition(generatedPosition);
      }

      const positionInTransformedFragment = transformedFragmentMapper
        .getGeneratedPosition(generatedPosition);

      if (is_invalid_position(positionInTransformedFragment)) {
        return positionInTransformedFragment;
      }

      const relocatedOriginalPosition = relocationMapper?.getOriginalPosition(
        positionInTransformedFragment,
      );

      if (
        relocatedOriginalPosition &&
        !is_invalid_position(relocatedOriginalPosition)
      ) {
        return originalFragmentMapper.getOriginalPosition(
          relocatedOriginalPosition,
        );
      }

      const positionInOriginalFragment = sourceMapper.getOriginalPosition(
        positionInTransformedFragment,
      );

      if (is_invalid_position(positionInOriginalFragment)) {
        return positionInOriginalFragment;
      }

      return originalFragmentMapper.getOriginalPosition(
        positionInOriginalFragment,
      );
    },
    getGeneratedPosition(originalPosition: any) {
      if (!originalFragmentMapper.isInGenerated(originalPosition)) {
        return fullDocumentMapper.getGeneratedPosition(originalPosition);
      }

      const positionInOriginalFragment = originalFragmentMapper
        .getGeneratedPosition(originalPosition);

      if (is_invalid_position(positionInOriginalFragment)) {
        return positionInOriginalFragment;
      }

      const relocatedGeneratedPosition = relocationMapper?.getGeneratedPosition(
        positionInOriginalFragment,
      );

      if (
        relocatedGeneratedPosition &&
        !is_invalid_position(relocatedGeneratedPosition)
      ) {
        return transformedFragmentMapper.getOriginalPosition(
          relocatedGeneratedPosition,
        );
      }

      const positionInTransformedFragment = sourceMapper.getGeneratedPosition(
        positionInOriginalFragment,
      );

      if (is_invalid_position(positionInTransformedFragment)) {
        return positionInTransformedFragment;
      }

      return transformedFragmentMapper.getOriginalPosition(
        positionInTransformedFragment,
      );
    },
    isInGenerated(originalPosition: any) {
      const generatedPosition = this.getGeneratedPosition(originalPosition);
      return !is_invalid_position(generatedPosition);
    },
  };
}
