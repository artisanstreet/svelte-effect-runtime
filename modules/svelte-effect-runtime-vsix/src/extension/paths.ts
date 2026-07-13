import process from "node:process";
import path from "node:path";

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
