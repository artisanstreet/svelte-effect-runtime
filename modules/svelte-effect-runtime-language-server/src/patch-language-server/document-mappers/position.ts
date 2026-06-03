import type { DocumentPosition } from "../types.ts";

/**
 * Checks whether a language-server position represents an unmappable location.
 *
 * @example
 * ```ts
 * if (is_invalid_position(position)) return position;
 * ```
 *
 * @since 2.0.0
 * @param position - Position returned by a document mapper.
 * @returns Whether the position is outside the mapped document.
 */
export function is_invalid_position(position: DocumentPosition): boolean {
  return position.line < 0 || position.character < 0;
}

/**
 * Converts between offsets and line/character positions for a fixed text
 * snapshot.
 *
 * @example
 * ```ts
 * const table = new OffsetTable(source);
 * const offset = table.offsetAt({ line: 0, character: 5 });
 * ```
 *
 * @since 2.0.0
 */
export class OffsetTable {
  private readonly line_starts: number[];

  constructor(text: string) {
    this.line_starts = [0];

    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10) {
        this.line_starts.push(index + 1);
      }
    }
  }

  offsetAt(position: DocumentPosition): number {
    if (position.line < 0 || position.line >= this.line_starts.length) {
      return -1;
    }

    return this.line_starts[position.line] + position.character;
  }

  positionAt(offset: number): DocumentPosition {
    if (offset < 0) {
      return { line: -1, character: -1 };
    }

    let low = 0;
    let high = this.line_starts.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const line_start = this.line_starts[middle];
      const next_line_start = this.line_starts[middle + 1] ??
        Number.POSITIVE_INFINITY;

      if (offset < line_start) {
        high = middle - 1;
        continue;
      }

      if (offset >= next_line_start) {
        low = middle + 1;
        continue;
      }

      return {
        line: middle,
        character: offset - line_start,
      };
    }

    return { line: -1, character: -1 };
  }
}
