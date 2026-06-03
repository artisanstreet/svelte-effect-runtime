import path from "node:path";

/**
 * Compares two filesystem paths using normalized case-insensitive semantics.
 *
 * @example
 * ```ts
 * if (paths_equal(current_path, managed_path)) restore();
 * ```
 *
 * @since 2.0.0
 * @param left - First path to compare.
 * @param right - Second path to compare.
 * @returns Whether both paths point at the same normalized location.
 */
export function paths_equal(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return path.normalize(left).toLowerCase() ===
    path.normalize(right).toLowerCase();
}
