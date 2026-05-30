// deno-lint-ignore-file no-explicit-any

export function is_invalid_position(position: any) {
  return position.line < 0 || position.character < 0;
}

export class OffsetTable {
  private readonly lineStarts: number[];

  constructor(text: string) {
    this.lineStarts = [0];

    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10) {
        this.lineStarts.push(index + 1);
      }
    }
  }

  offsetAt(position: { line: number; character: number }) {
    if (position.line < 0 || position.line >= this.lineStarts.length) {
      return -1;
    }

    return this.lineStarts[position.line] + position.character;
  }

  positionAt(offset: number) {
    if (offset < 0) {
      return { line: -1, character: -1 };
    }

    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const lineStart = this.lineStarts[middle];
      const nextLineStart = this.lineStarts[middle + 1] ??
        Number.POSITIVE_INFINITY;

      if (offset < lineStart) {
        high = middle - 1;
        continue;
      }

      if (offset >= nextLineStart) {
        low = middle + 1;
        continue;
      }

      return {
        line: middle,
        character: offset - lineStart,
      };
    }

    return { line: -1, character: -1 };
  }
}
