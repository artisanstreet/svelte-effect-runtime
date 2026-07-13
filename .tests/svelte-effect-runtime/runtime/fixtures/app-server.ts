function fail(name: string): never {
	throw new Error(`${name} can only be used inside a SvelteKit server module during tests`);
}

let current_request_event: unknown;

/**
 * Fails when the test fixture's query shim is invoked directly.
 *
 * @example
 * ```ts
 * query();
 * ```
 *
 * @since 3.4.5
 * @returns Never returns because this shim is only a fixture boundary.
 */
export function query(): never {
	return fail("query");
}

export namespace query {
	/**
	 * Fails when the test fixture's query batch shim is invoked directly.
	 *
	 * @example
	 * ```ts
	 * query.batch();
	 * ```
	 *
	 * @since 3.4.5
	 * @returns Never returns because this shim is only a fixture boundary.
	 */
	export function batch(): never {
		return fail("query.batch");
	}

	/**
	 * Fails when the test fixture's live query shim is invoked directly.
	 *
	 * @example
	 * ```ts
	 * query.live();
	 * ```
	 *
	 * @since 3.4.5
	 * @returns Never returns because this shim is only a fixture boundary.
	 */
	export function live(): never {
		return fail("query.live");
	}
}

/**
 * Fails when the test fixture's command shim is invoked directly.
 *
 * @example
 * ```ts
 * command();
 * ```
 *
 * @since 3.4.5
 * @returns Never returns because this shim is only a fixture boundary.
 */
export function command(): never {
	return fail("command");
}

/**
 * Fails when the test fixture's form shim is invoked directly.
 *
 * @example
 * ```ts
 * form();
 * ```
 *
 * @since 3.4.5
 * @returns Never returns because this shim is only a fixture boundary.
 */
export function form(): never {
	return fail("form");
}

/**
 * Fails when the test fixture's prerender shim is invoked directly.
 *
 * @example
 * ```ts
 * prerender();
 * ```
 *
 * @since 3.4.5
 * @returns Never returns because this shim is only a fixture boundary.
 */
export function prerender(): never {
	return fail("prerender");
}

/**
 * Returns the request event installed for the active server test.
 *
 * @example
 * ```ts
 * set_test_request_event({ url: new URL("https://example.com") });
 * const event = getRequestEvent();
 * ```
 *
 * @since 3.4.5
 * @returns The installed request event, or never when no event has been installed.
 */
export function getRequestEvent(): unknown {
	if (current_request_event === undefined) {
		return fail("getRequestEvent");
	}

	return current_request_event;
}

/**
 * Installs the request event returned by the test fixture.
 *
 * @example
 * ```ts
 * set_test_request_event({ url: new URL("https://example.com/effect") });
 * ```
 *
 * @since 4.0.0
 * @param event - Request event value exposed to the server code under test.
 * @returns Nothing; the event remains installed until it is replaced or reset.
 */
export function set_test_request_event(event: unknown): void {
	current_request_event = event;
}

/**
 * Clears the request event installed for the active server test.
 *
 * @example
 * ```ts
 * reset_test_request_event();
 * ```
 *
 * @since 4.0.0
 * @returns Nothing; subsequent reads fail until another event is installed.
 */
export function reset_test_request_event(): void {
	current_request_event = undefined;
}
