function fail(name: string): never {
	throw new Error(`${name} can only be used inside a SvelteKit server module during tests`);
}

type RemoteFactory = (...args: unknown[]) => unknown;

let current_request_event: unknown;
let current_command_factory: RemoteFactory | undefined;
let current_prerender_factory: RemoteFactory | undefined;

export function query(): never {
	return fail("query");
}

export namespace query {
	export function batch(): never {
		return fail("query.batch");
	}

	export function live(): never {
		return fail("query.live");
	}
}

export function command(...args: unknown[]): unknown {
	if (!current_command_factory) {
		return fail("command");
	}

	return current_command_factory(...args);
}

export function form(): never {
	return fail("form");
}

export function prerender(...args: unknown[]): unknown {
	if (!current_prerender_factory) {
		return fail("prerender");
	}

	return current_prerender_factory(...args);
}

export function getRequestEvent(): unknown {
	if (current_request_event === undefined) {
		return fail("getRequestEvent");
	}

	return current_request_event;
}

export function make_test_request_event(url = "http://localhost/"): {
	request: Request;
	url: URL;
} {
	return {
		request: new Request(url),
		url: new URL(url),
	};
}

export function set_test_request_event(event: unknown): void {
	current_request_event = event;
}

export function reset_test_request_event(): void {
	current_request_event = undefined;
}

export function set_test_command(factory: RemoteFactory): void {
	current_command_factory = factory;
}

export function reset_test_command(): void {
	current_command_factory = undefined;
}

export function set_test_prerender(factory: RemoteFactory): void {
	current_prerender_factory = factory;
}

export function reset_test_prerender(): void {
	current_prerender_factory = undefined;
}
