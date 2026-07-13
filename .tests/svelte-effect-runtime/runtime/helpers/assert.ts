import assert from "node:assert/strict";

type ErrorConstructor<T extends Error> = new (...args: never[]) => T;

type ExpectedError<T extends Error> = ErrorConstructor<T> | string;

/**
 * Asserts that a value is truthy and narrows it to its truthy type.
 *
 * @example
 * ```ts
 * const user = await load_user();
 * assert_truthy(user);
 * ```
 *
 * @since 3.4.5
 * @param value - Value that must evaluate to true for the assertion to pass.
 * @param message - Optional failure message reported when the value is falsy.
 * @returns Nothing; the function narrows the value or throws an assertion error.
 */
export function assert_truthy(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
}

/**
 * Asserts that two values are deeply equal.
 *
 * @example
 * ```ts
 * assert_equals(response, { status: "ready" });
 * ```
 *
 * @since 3.4.5
 * @param actual - Value produced by the behavior under test.
 * @param expected - Value that the actual result must deeply equal.
 * @param message - Optional failure message reported when the values differ.
 * @returns Nothing; the function throws an assertion error when the values differ.
 */
export function assert_equals(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
}

/**
 * Asserts that a value is exactly false.
 *
 * @example
 * ```ts
 * assert_false(result.cancelled);
 * ```
 *
 * @since 3.4.5
 * @param actual - Value that must be the boolean literal false.
 * @param message - Optional failure message reported when the value is not false.
 * @returns Nothing; the function throws an assertion error when the value is not false.
 */
export function assert_false(actual: unknown, message?: string): void {
	assert.equal(actual, false, message);
}

/**
 * Asserts that a value is neither null nor undefined and narrows its type.
 *
 * @example
 * ```ts
 * const user = users.get("sander");
 * assert_exists(user);
 * ```
 *
 * @since 3.4.5
 * @param actual - Value that must exist for the assertion to pass.
 * @param message - Optional failure message reported when the value is nullish.
 * @returns Nothing; the function narrows the value or throws an assertion error.
 */
export function assert_exists<T>(
	actual: T | null | undefined,
	message?: string,
): asserts actual is T {
	assert.notEqual(actual, null, message);
}

/**
 * Asserts that a string contains an expected substring.
 *
 * @example
 * ```ts
 * assert_string_includes(error.message, "connection failed");
 * ```
 *
 * @since 3.4.5
 * @param actual - String produced by the behavior under test.
 * @param expected - Substring that must occur within the actual string.
 * @param message - Optional failure message reported when the substring is absent.
 * @returns Nothing; the function throws an assertion error when the substring is absent.
 */
export function assert_string_includes(actual: string, expected: string, message?: string): void {
	assert.ok(
		actual.includes(expected),
		message ?? `Expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`,
	);
}

/**
 * Asserts that a string matches an expected regular expression.
 *
 * @example
 * ```ts
 * assert_match(diagnostic, /REMOTE_FAILURE/);
 * ```
 *
 * @since 3.4.5
 * @param actual - String produced by the behavior under test.
 * @param expected - Regular expression that must match the actual string.
 * @param message - Optional failure message reported when the expression does not match.
 * @returns Nothing; the function throws an assertion error when the expression does not match.
 */
export function assert_match(actual: string, expected: RegExp, message?: string): void {
	assert.match(actual, expected, message);
}

/**
 * Asserts that a string does not match a regular expression.
 *
 * @example
 * ```ts
 * assert_not_match(generated_code, /Effect\.runPromise/);
 * ```
 *
 * @since 3.4.5
 * @param actual - String produced by the behavior under test.
 * @param expected - Regular expression that must not match the actual string.
 * @param message - Optional failure message reported when the expression matches.
 * @returns Nothing; the function throws an assertion error when the expression matches.
 */
export function assert_not_match(actual: string, expected: RegExp, message?: string): void {
	assert.doesNotMatch(actual, expected, message);
}

/**
 * Asserts that a function throws and returns the captured error.
 *
 * @example
 * ```ts
 * const error = assert_throws(() => {
 * \tthrow new Error("missing request");
 * }, Error, "missing request");
 * ```
 *
 * @since 3.4.5
 * @param fn - Synchronous operation expected to throw.
 * @param expected - Optional error constructor or message fragment the failure must match.
 * @param message_includes - Optional message fragment used with an expected constructor.
 * @returns The captured error after its type and message expectations are validated.
 */
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

/**
 * Asserts that an operation rejects and returns the captured error.
 *
 * @example
 * ```ts
 * const error = await assert_rejects(
 * \t() => Promise.reject(new Error("request failed")),
 * \tError,
 * \t"request failed",
 * );
 * ```
 *
 * @since 3.4.5
 * @param fn - Operation expected to throw or return a rejected promise.
 * @param expected - Optional error constructor or message fragment the failure must match.
 * @param message_includes - Optional message fragment used with an expected constructor.
 * @returns The captured error after its type and message expectations are validated.
 */
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
