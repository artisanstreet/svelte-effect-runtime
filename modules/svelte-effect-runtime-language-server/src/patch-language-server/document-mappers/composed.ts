// deno-lint-ignore-file no-explicit-any
import { is_invalid_position } from "./position.ts";
import type { Mapper } from "../types.ts";

export class SequentialDocumentMapper {
  constructor(
    private readonly mappers: Mapper[],
    private readonly url: string,
  ) {}

  getOriginalPosition(generatedPosition: any) {
    return this.mappers.reduce((position, mapper) => {
      if (is_invalid_position(position)) {
        return position;
      }

      return mapper.getOriginalPosition(position);
    }, generatedPosition);
  }

  getGeneratedPosition(originalPosition: any) {
    return [...this.mappers].reverse().reduce((position, mapper) => {
      if (is_invalid_position(position)) {
        return position;
      }

      return mapper.getGeneratedPosition(position);
    }, originalPosition);
  }

  isInGenerated(originalPosition: any) {
    const generatedPosition = this.getGeneratedPosition(originalPosition);
    return generatedPosition.line >= 0 && generatedPosition.character >= 0;
  }

  getURL() {
    return this.url;
  }
}

export class SnapshotDocumentMapper {
  constructor(
    private readonly innerMapper: Mapper,
    private readonly preprocessMapper: Mapper,
    private readonly url: string,
  ) {}

  getOriginalPosition(generatedPosition: any) {
    return this.preprocessMapper.getOriginalPosition(
      this.innerMapper.getOriginalPosition(generatedPosition),
    );
  }

  getGeneratedPosition(originalPosition: any) {
    const preprocessedPosition = this.preprocessMapper.getGeneratedPosition(
      originalPosition,
    );

    if (is_invalid_position(preprocessedPosition)) {
      return preprocessedPosition;
    }

    return this.innerMapper.getGeneratedPosition(preprocessedPosition);
  }

  isInGenerated(originalPosition: any) {
    const preprocessedPosition = this.preprocessMapper.getGeneratedPosition(
      originalPosition,
    );

    if (is_invalid_position(preprocessedPosition)) {
      return false;
    }

    return this.innerMapper.isInGenerated(preprocessedPosition);
  }

  getURL() {
    return this.url;
  }
}
