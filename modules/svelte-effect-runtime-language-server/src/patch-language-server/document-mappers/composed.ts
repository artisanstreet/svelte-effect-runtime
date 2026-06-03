import { is_invalid_position } from "./position.ts";
import type { DocumentPosition, Mapper } from "../types.ts";

/**
 * Composes multiple document mappers in sequence.
 *
 * @example
 * ```ts
 * const mapper = new SequentialDocumentMapper([first, second], uri);
 * ```
 *
 * @since 2.0.0
 */
export class SequentialDocumentMapper {
  constructor(
    private readonly mappers: Mapper[],
    private readonly url: string,
  ) {}

  getOriginalPosition(generated_position: DocumentPosition): DocumentPosition {
    return this.mappers.reduce((position, mapper) => {
      if (is_invalid_position(position)) {
        return position;
      }

      return mapper.getOriginalPosition(position);
    }, generated_position);
  }

  getGeneratedPosition(original_position: DocumentPosition): DocumentPosition {
    return [...this.mappers].reverse().reduce((position, mapper) => {
      if (is_invalid_position(position)) {
        return position;
      }

      return mapper.getGeneratedPosition(position);
    }, original_position);
  }

  isInGenerated(original_position: DocumentPosition): boolean {
    const generated_position = this.getGeneratedPosition(original_position);

    return !is_invalid_position(generated_position);
  }

  getURL(): string {
    return this.url;
  }
}

/**
 * Combines the original snapshot mapper with the preprocessor mapper.
 *
 * @example
 * ```ts
 * const mapper = new SnapshotDocumentMapper(inner, preprocess, uri);
 * ```
 *
 * @since 2.0.0
 */
export class SnapshotDocumentMapper {
  constructor(
    private readonly inner_mapper: Mapper,
    private readonly preprocess_mapper: Mapper,
    private readonly url: string,
  ) {}

  getOriginalPosition(generated_position: DocumentPosition): DocumentPosition {
    return this.preprocess_mapper.getOriginalPosition(
      this.inner_mapper.getOriginalPosition(generated_position),
    );
  }

  getGeneratedPosition(original_position: DocumentPosition): DocumentPosition {
    const preprocessed_position = this.preprocess_mapper.getGeneratedPosition(
      original_position,
    );

    if (is_invalid_position(preprocessed_position)) {
      return preprocessed_position;
    }

    return this.inner_mapper.getGeneratedPosition(preprocessed_position);
  }

  isInGenerated(original_position: DocumentPosition): boolean {
    const preprocessed_position = this.preprocess_mapper.getGeneratedPosition(
      original_position,
    );

    if (is_invalid_position(preprocessed_position)) {
      return false;
    }

    return this.inner_mapper.isInGenerated(preprocessed_position);
  }

  getURL(): string {
    return this.url;
  }
}
