import { Data, PlatformError } from "effect";

export class ServerInstallRetentionError extends Data.TaggedError("ServerInstallRetentionError")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

export function is_missing_platform_error(error: unknown): error is PlatformError.PlatformError {
	return error instanceof PlatformError.PlatformError && error.reason._tag === "NotFound";
}

export function format_server_install_retention_error(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
