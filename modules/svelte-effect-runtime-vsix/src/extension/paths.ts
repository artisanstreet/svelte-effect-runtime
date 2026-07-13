import process from "node:process";
import path from "node:path";

/**
 * Compares two filesystem paths using the host platform's case semantics.
 *
 * @example
 * ```ts
 * if (paths_equal(current_path, managed_path)) restore();
 * ```
 *
 * @since 2.0.0
 * @param left - First path to compare.
 * @param right - Second path to compare.
 * @param platform - Platform whose filesystem case semantics should be used.
 * @returns Whether both paths point at the same normalized location.
 */
export function paths_equal(
	left: string | undefined,
	right: string | undefined,
	platform: NodeJS.Platform = process.platform,
): boolean {
	if (!left || !right) {
		return false;
	}

	const path_service = platform === "win32" ? path.win32 : path.posix;
	const normalized_left = path_service.normalize(left);
	const normalized_right = path_service.normalize(right);

	if (platform === "win32") {
		return normalized_left.toLowerCase() === normalized_right.toLowerCase();
	}

	return normalized_left === normalized_right;
}
