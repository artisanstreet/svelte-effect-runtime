function fail(name: string): never {
	throw new Error(`${name} can only be used inside a SvelteKit server module during tests`);
}

let current_request_event: unknown;

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

export function command(): never {
	return fail("command");
}

export function form(): never {
	return fail("form");
}

export function prerender(): never {
	return fail("prerender");
}

export function getRequestEvent(): unknown {
	if (current_request_event === undefined) {
		return fail("getRequestEvent");
	}

	return current_request_event;
}

export function set_test_request_event(event: unknown): void {
	current_request_event = event;
}

export function reset_test_request_event(): void {
	current_request_event = undefined;
}
