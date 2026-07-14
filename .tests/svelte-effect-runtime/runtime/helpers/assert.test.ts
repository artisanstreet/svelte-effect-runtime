import { assert_exists, assert_throws } from "./assert.ts";
import { test } from "vitest";

test("assert_exists rejects undefined", () => {
	assert_throws(() => assert_exists(undefined));
});
