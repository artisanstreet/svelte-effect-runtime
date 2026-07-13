import { SvelteKitServerExportUnavailableError } from "$/errors.ts";

/**
 * Publish-time shim for SvelteKit's virtual `$app/server` module.
 *
 * @example
 * ```ts
 * query("hash", handler);
 * ```
 *
 * @since 2.0.0
 * @param _args - Arguments forwarded by runtime factories.
 * @returns Never returns because this shim is not executable.
 */
export function query(..._args: ReadonlyArray<unknown>): never {
	throw make_sveltekit_server_error("query");
}

/**
 * Publish-time shim for SvelteKit's virtual `$app/server` command export.
 *
 * @example
 * ```ts
 * command("hash", handler);
 * ```
 *
 * @since 2.0.0
 * @param _args - Arguments forwarded by runtime factories.
 * @returns Never returns because this shim is not executable.
 */
export function command(..._args: ReadonlyArray<unknown>): never {
	throw make_sveltekit_server_error("command");
}

/**
 * Publish-time shim for SvelteKit's virtual `$app/server` form export.
 *
 * @example
 * ```ts
 * form("hash", handler);
 * ```
 *
 * @since 2.0.0
 * @param _args - Arguments forwarded by runtime factories.
 * @returns Never returns because this shim is not executable.
 */
export function form(..._args: ReadonlyArray<unknown>): never {
	throw make_sveltekit_server_error("form");
}

/**
 * Publish-time shim for SvelteKit's virtual `$app/server` prerender export.
 *
 * @example
 * ```ts
 * prerender("hash", handler);
 * ```
 *
 * @since 2.0.0
 * @param _args - Arguments forwarded by runtime factories.
 * @returns Never returns because this shim is not executable.
 */
export function prerender(..._args: ReadonlyArray<unknown>): never {
	throw make_sveltekit_server_error("prerender");
}

/**
 * Publish-time shim for SvelteKit's virtual `$app/server` request export.
 *
 * @example
 * ```ts
 * getRequestEvent();
 * ```
 *
 * @since 2.0.0
 * @returns Never returns because this shim is not executable.
 */
export function getRequestEvent(): never {
	throw make_sveltekit_server_error("getRequestEvent");
}

function make_sveltekit_server_error(name: string): Error {
	return new SvelteKitServerExportUnavailableError(name);
}
