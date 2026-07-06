function fail(name: string): never {
	throw new Error(`${name} can only be used inside a SvelteKit server module during tests`);
}

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

export function getRequestEvent(): never {
	return fail("getRequestEvent");
}
