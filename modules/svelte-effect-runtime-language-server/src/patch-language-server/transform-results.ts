import MagicString from "magic-string";

import type { TransformResult } from "./types.ts";

export function normalize_transform_result(
  result: TransformResult,
  original_code: string,
  filename: string,
) {
  return {
    ...result,
    map: result.map ?? create_identity_source_map(original_code, filename),
  };
}

function create_identity_source_map(
  code: string,
  filename: string,
): Record<string, unknown> {
  const magic = new MagicString(code);

  return magic.generateMap({
    hires: true,
    includeContent: true,
    source: filename,
  }) as unknown as Record<string, unknown>;
}
