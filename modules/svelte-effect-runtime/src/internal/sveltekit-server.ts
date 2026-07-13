import { SvelteKitServerExportUnavailableError } from "$/errors.ts";

export function query(..._args: ReadonlyArray<unknown>): never {
	throw make_sveltekit_server_error("query");
}

export function command(..._args: ReadonlyArray<unknown>): never {
	throw make_sveltekit_server_error("command");
}

export function form(..._args: ReadonlyArray<unknown>): never {
	throw make_sveltekit_server_error("form");
}

export function prerender(..._args: ReadonlyArray<unknown>): never {
	throw make_sveltekit_server_error("prerender");
}

export function getRequestEvent(): never {
	throw make_sveltekit_server_error("getRequestEvent");
}

function make_sveltekit_server_error(name: string): Error {
	return new SvelteKitServerExportUnavailableError(name);
}
