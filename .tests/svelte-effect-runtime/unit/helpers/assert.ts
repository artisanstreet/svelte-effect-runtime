import assert from "node:assert/strict";

type ErrorConstructor<T extends Error> = new (...args: never[]) => T;

type ExpectedError<T extends Error> = ErrorConstructor<T> | string;

export function assert_truthy(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
}

export function assert_equals(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
}

export function assert_false(actual: unknown, message?: string): void {
	assert.equal(actual, false, message);
}

export function assert_exists<T>(
	actual: T | null | undefined,
	message?: string,
): asserts actual is T {
	assert.ok(actual !== null && actual !== undefined, message);
}

export function assert_string_includes(actual: string, expected: string, message?: string): void {
	assert.ok(
		actual.includes(expected),
		message ?? `Expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`,
	);
}

export function assert_match(actual: string, expected: RegExp, message?: string): void {
	assert.match(actual, expected, message);
}

export function assert_not_match(actual: string, expected: RegExp, message?: string): void {
	assert.doesNotMatch(actual, expected, message);
}

export function assert_throws<T extends Error = Error>(
	fn: () => unknown,
	expected?: ExpectedError<T>,
	message_includes?: string,
): T {
	try {
		fn();
	} catch (error) {
		return validate_error(error, expected, message_includes);
	}

	assert.fail("Expected function to throw");
}

export async function assert_rejects<T extends Error = Error>(
	fn: () => Promise<unknown> | unknown,
	expected?: ExpectedError<T>,
	message_includes?: string,
): Promise<T> {
	try {
		await fn();
	} catch (error) {
		return validate_error(error, expected, message_includes);
	}

	assert.fail("Expected function to reject");
}

function validate_error<T extends Error>(
	error: unknown,
	expected?: ExpectedError<T>,
	message_includes?: string,
): T {
	const expected_message = typeof expected === "string" ? expected : message_includes;

	if (typeof expected === "function") {
		assert.ok(
			error instanceof expected,
			`Expected ${describe_error(error)} to be an instance of ${expected.name}`,
		);
	}

	if (expected_message) {
		assert_string_includes(describe_error(error), expected_message);
	}

	return error as T;
}

function describe_error(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
