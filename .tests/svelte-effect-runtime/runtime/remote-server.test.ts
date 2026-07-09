import { test } from "vitest";
import {
	assert_false,
	assert_truthy,
	assert_equals,
	assert_throws,
	assert_rejects,
	assert_string_includes,
} from "./helpers/assert.ts";
import {
	error as svelte_error,
	invalid as svelte_invalid,
	isHttpError,
	isRedirect,
	isValidationError,
	redirect as svelte_redirect,
} from "@sveltejs/kit";
import { Data, Effect, Stream } from "effect";
import { parse } from "devalue";
import {
	Error as RootError,
	Redirect as RootRedirect,
} from "../../../modules/svelte-effect-runtime/src/mod.ts";
import {
	Error as ServerError,
	Redirect as ServerRedirect,
} from "../../../modules/svelte-effect-runtime/src/server/index.ts";
import { run_live_handler_source } from "../../../modules/svelte-effect-runtime/src/server/effects.ts";
import {
	encode_remote_failure,
	normalize_remote_helper_error,
	run_remote_effect,
	throw_form_error,
} from "../../../modules/svelte-effect-runtime/src/remote/server.ts";
import { create_form_error } from "../../../modules/svelte-effect-runtime/src/remote/shared.ts";
import * as sveltekit_server from "../../../modules/svelte-effect-runtime/src/internal/sveltekit-server.ts";

// ─── normalize_remote_helper_error ─────────────────────────────

test("normalize_remote_helper_error wraps request-event context errors", () => {
	const err = new Error(
		"Can only read the current request event inside functions invoked during `handle`, such as server `load` functions, actions, endpoints, and other server hooks.",
	);
	const result = normalize_remote_helper_error(err, "Query");

	assert_string_includes(result.message, "[REMOTE_HELPER_CONTEXT]:");
	assert_string_includes(result.message, "Query was called outside a .remote.ts file");
});

test("normalize_remote_helper_error wraps request-store context errors", () => {
	const err = new Error("Could not get the request store.");
	const result = normalize_remote_helper_error(err, "Query");

	assert_string_includes(result.message, "[REMOTE_HELPER_CONTEXT]:");
	assert_string_includes(result.message, "Query was called outside a .remote.ts file");
});

test("normalize_remote_helper_error preserves other error messages", () => {
	const err = new Error("something else");
	const result = normalize_remote_helper_error(err, "Command");

	assert_equals(result, err);
	assert_equals(result.message, "something else");
});

test("normalize_remote_helper_error preserves unrelated cannot-use errors", () => {
	const err = new Error("Cannot use `goto` with an external URL. Use `window.location` instead");
	const result = normalize_remote_helper_error(err, "Query");

	assert_equals(result, err);
});

test("normalize_remote_helper_error wraps non-Error values", () => {
	const result = normalize_remote_helper_error("raw string", "Form");

	assert_truthy(result instanceof Error);
	assert_equals(result.message, "[REMOTE_HELPER_ERROR]: raw string");
});

test("SvelteKit server fallback exports throw clear boundary errors", () => {
	const exports = [
		["query", () => sveltekit_server.query()],
		["command", () => sveltekit_server.command()],
		["form", () => sveltekit_server.form()],
		["prerender", () => sveltekit_server.prerender()],
		["getRequestEvent", () => sveltekit_server.getRequestEvent()],
	] as const;

	for (const [name, call] of exports) {
		const error = assert_throws(call, Error);

		assert_string_includes(error.message, name);
		assert_string_includes(error.message, "inside a SvelteKit server module");
	}
});

// ─── throw_form_error ──────────────────────────────────────────

test("throw_form_error calls invalid with issues", () => {
	const captured_issues: unknown[] = [];

	const invalid = (...issues: unknown[]): never => {
		captured_issues.push(...issues);
		throw new Error("invalid called");
	};

	try {
		throw_form_error([{ message: "bad input", path: ["field"] }], invalid);
	} catch {
		assert_equals(captured_issues, [{ message: "bad input", path: ["field"] }]);
	}
});

// ─── encode_remote_failure ─────────────────────────────────────

test("encode_remote_failure serialises a tagged error from a Cause", async () => {
	const program = Effect.gen(function* () {
		return yield* Effect.fail({ _tag: "MyError", code: 42 });
	});

	const exit = await Effect.runPromise(Effect.exit(program));
	const failure = exit as { _tag: string; cause: unknown };

	if (failure._tag !== "Failure") {
		throw new Error("expected failed exit");
	}

	const encoded = encode_remote_failure(failure.cause);
	const parsed = parse(encoded);

	assert_equals(parsed._tag, "MyError");
	assert_equals(parsed.code, 42);
});

test("encode_remote_failure serialises Effect tagged error instances", async () => {
	class AuthenticationError extends Data.TaggedError("AuthenticationError")<{
		readonly message: string;
		readonly reason: string;
	}> {}

	const program = Effect.gen(function* () {
		return yield* Effect.fail(
			new AuthenticationError({
				message: "OAuth is currently disabled",
				reason: "development",
			}),
		);
	});

	const exit = await Effect.runPromise(Effect.exit(program));
	const failure = exit as { _tag: string; cause: unknown };

	if (failure._tag !== "Failure") {
		throw new Error("expected failed exit");
	}

	const encoded = encode_remote_failure(failure.cause);
	const parsed = parse(encoded);

	assert_equals(parsed._tag, "AuthenticationError");
	assert_equals(parsed.message, "OAuth is currently disabled");
	assert_equals(parsed.reason, "development");
});

test("encode_remote_failure serialises cyclic failure records safely", () => {
	const failure: Record<string, unknown> = {
		_tag: "CircularError",
		message: "loop",
	};

	failure.self = failure;
	failure.fn = () => {};
	failure.token = Symbol("token");

	const encoded = encode_remote_failure({
		reasons: [{ _tag: "Fail", error: failure }],
	} as never);
	const parsed = parse(encoded);

	assert_equals(parsed._tag, "CircularError");
	assert_equals(parsed.message, "loop");
	assert_equals(parsed.self, undefined);
	assert_equals(parsed.fn, undefined);
	assert_equals(parsed.token, undefined);
});

test("encode_remote_failure redacts ordinary Error messages and fields", () => {
	const failure = new Error("boom") as Error & { code?: string };

	failure.code = "E_BOOM";

	const encoded = encode_remote_failure({
		reasons: [{ _tag: "Fail", error: failure }],
	} as never);
	const parsed = parse(encoded);

	assert_equals(parsed.message, "[UNKNOWN_REMOTE_FAILURE]: Unknown error");
	assert_equals(parsed.code, undefined);
	assert_false(encoded.includes("boom"));
	assert_false(encoded.includes("E_BOOM"));
});

test("encode_remote_failure redacts untagged failure records", () => {
	const encoded = encode_remote_failure({
		reasons: [
			{
				_tag: "Fail",
				error: {
					message: "database password rejected",
					token: "server-secret-token",
				},
			},
		],
	} as never);
	const parsed = parse(encoded);

	assert_equals(parsed.message, "[UNKNOWN_REMOTE_FAILURE]: Unknown error");
	assert_equals(parsed.token, undefined);
	assert_false(encoded.includes("database password"));
	assert_false(encoded.includes("server-secret-token"));
});

test("encode_remote_failure handles cause with no failures gracefully", () => {
	/** A v4-style Cause with empty reasons array. */
	const cause = { reasons: [] };
	const encoded = encode_remote_failure(cause);
	const parsed = parse(encoded);

	assert_equals(parsed.message, "[UNKNOWN_REMOTE_FAILURE]: Unknown error");
});

// ─── run_remote_effect ─────────────────────────────────────────

test("Error resolves named status aliases", async () => {
	const thrown = await assert_rejects(() =>
		Effect.runPromise(ServerError("NotFound", "missing")),
	);

	assert_truthy(isHttpError(thrown, 404));
	assert_equals(thrown.body, { message: "missing", status: 404 });
});

test("Error passes numeric statuses through", async () => {
	const thrown = await assert_rejects(() =>
		Effect.runPromise(ServerError(418, "short and stout")),
	);

	assert_truthy(isHttpError(thrown, 418));
	assert_equals(thrown.body, { message: "short and stout", status: 418 });
});

test("Error accepts SvelteKit 3 properties overload", async () => {
	const thrown = await assert_rejects(() =>
		Effect.runPromise(ServerError(400, "bad request", {})),
	);

	assert_truthy(isHttpError(thrown, 400));
	assert_equals(thrown.body, { message: "bad request", status: 400 });
});

test("Redirect resolves named status aliases", async () => {
	const thrown = await assert_rejects(() =>
		Effect.runPromise(ServerRedirect("TemporaryRedirect", "/oauth")),
	);

	assert_truthy(isRedirect(thrown));
	assert_equals(thrown.status, 307);
	assert_equals(thrown.location, "/oauth");
});

test("Redirect passes numeric statuses through", async () => {
	const thrown = await assert_rejects(() => Effect.runPromise(ServerRedirect(303, "/done")));

	assert_truthy(isRedirect(thrown));
	assert_equals(thrown.status, 303);
	assert_equals(thrown.location, "/done");
});

test("Redirect passes SvelteKit 3 external options through", async () => {
	const thrown = await assert_rejects(() =>
		Effect.runPromise(ServerRedirect(303, "https://example.com/oauth", { external: true })),
	);

	assert_truthy(isRedirect(thrown));
	assert_equals(thrown.status, 303);
	assert_equals(thrown.location, "https://example.com/oauth");
});

test("control-flow helpers type-check in Effect generators", () => {
	const server_error_program = Effect.gen(function* () {
		return yield* ServerError("NotFound", "missing", {});
	});

	const server_redirect_program = Effect.gen(function* () {
		return yield* ServerRedirect("SeeOther", "https://example.com/done", {
			external: true,
		});
	});

	const root_error_program = Effect.gen(function* () {
		return yield* RootError("NotFound", "missing", {});
	});

	const root_redirect_program = Effect.gen(function* () {
		return yield* RootRedirect("SeeOther", "https://example.com/done", {
			external: true,
		});
	});

	assert_truthy(Effect.isEffect(server_error_program));
	assert_truthy(Effect.isEffect(server_redirect_program));
	assert_truthy(Effect.isEffect(root_error_program));
	assert_truthy(Effect.isEffect(root_redirect_program));
});

test("run_remote_effect returns the success value", async () => {
	class TestRuntime {
		runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
			return Effect.runPromise(effect);
		}
	}

	const runtime = new TestRuntime();
	let invalid_called = false;
	let error_called = false;

	const result = await run_remote_effect(
		Effect.succeed(42),
		runtime,
		() => {
			invalid_called = true;
			throw new Error("invalid");
		},
		() => {
			error_called = true;
			throw new Error("error");
		},
	);

	assert_equals(result, 42);
	assert_truthy(!invalid_called);
	assert_truthy(!error_called);
});

test("run_remote_effect throws invalid on FormError failure", async () => {
	class TestRuntime {
		runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
			return Effect.runPromise(effect);
		}
	}

	const runtime = new TestRuntime();
	const issues = [{ message: "bad", path: ["x"] }];
	const form_error = create_form_error(issues);

	const captured_issues: unknown[] = [];

	await assert_rejects(async () => {
		await run_remote_effect(
			Effect.fail(form_error) as Effect.Effect<number, unknown>,
			runtime,
			(...received_issues) => {
				captured_issues.push(...received_issues);
				throw new Error("invalid");
			},
			() => {
				throw new Error("error");
			},
		);
	});

	assert_equals(captured_issues, issues);
});

test("run_remote_effect throws error on non-FormError failure", async () => {
	class TestRuntime {
		runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
			return Effect.runPromise(effect);
		}
	}

	const runtime = new TestRuntime();

	let captured_status = 0;
	let captured_body: unknown = null;

	await assert_rejects(async () => {
		await run_remote_effect(
			Effect.fail({ _tag: "DbError", detail: "connection lost" }),
			runtime,
			() => {
				throw new Error("invalid");
			},
			(status, body) => {
				captured_status = status;
				captured_body = body;
				throw new Error("error");
			},
		);
	});

	assert_equals(captured_status, 500);
	const body = captured_body as {
		__svelte_effect_remote__: true;
		encoded: string;
	};
	const parsed = parse(body.encoded);

	assert_equals(body.__svelte_effect_remote__, true);
	assert_equals(parsed._tag, "DbError");
});

test("run_remote_effect rethrows interrupt-only causes outside remote envelopes", async () => {
	class TestRuntime {
		runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
			return Effect.runPromise(effect);
		}
	}

	const runtime = new TestRuntime();
	let invalid_called = false;
	let error_called = false;

	await assert_rejects(() =>
		run_remote_effect(
			Effect.interrupt as Effect.Effect<never, unknown, unknown>,
			runtime,
			() => {
				invalid_called = true;
				throw new Error("invalid");
			},
			() => {
				error_called = true;
				throw new Error("error");
			},
		),
	);

	assert_false(invalid_called);
	assert_false(error_called);
});

test("run_remote_effect rethrows SvelteKit redirect defects", async () => {
	class TestRuntime {
		runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
			return Effect.runPromise(effect);
		}
	}

	const runtime = new TestRuntime();
	let invalid_called = false;
	let error_called = false;

	const thrown = await assert_rejects(async () => {
		await run_remote_effect(
			Effect.sync(() => svelte_redirect(303, "/oauth")),
			runtime,
			() => {
				invalid_called = true;
				throw new globalThis.Error("invalid");
			},
			() => {
				error_called = true;
				throw new globalThis.Error("error");
			},
		);
	});

	assert_truthy(isRedirect(thrown));
	assert_equals(thrown.status, 303);
	assert_equals(thrown.location, "/oauth");
	assert_false(invalid_called);
	assert_false(error_called);
});

test("run_remote_effect rethrows Redirect helper from generators", async () => {
	class TestRuntime {
		runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
			return Effect.runPromise(effect);
		}
	}

	const runtime = new TestRuntime();
	const program = Effect.gen(function* () {
		yield* Effect.sync(() => undefined);
		yield* ServerRedirect(303, "/oauth");
	});

	let invalid_called = false;
	let error_called = false;

	const thrown = await assert_rejects(async () => {
		await run_remote_effect(
			program,
			runtime,
			() => {
				invalid_called = true;
				throw new globalThis.Error("invalid");
			},
			() => {
				error_called = true;
				throw new globalThis.Error("error");
			},
		);
	});

	assert_truthy(isRedirect(thrown));
	assert_equals(thrown.status, 303);
	assert_equals(thrown.location, "/oauth");
	assert_false(invalid_called);
	assert_false(error_called);
});

test("run_remote_effect rethrows SvelteKit HTTP error defects", async () => {
	class TestRuntime {
		runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
			return Effect.runPromise(effect);
		}
	}

	const runtime = new TestRuntime();
	let invalid_called = false;
	let error_called = false;

	const thrown = await assert_rejects(async () => {
		await run_remote_effect(
			Effect.sync(() => svelte_error(404, "missing")),
			runtime,
			() => {
				invalid_called = true;
				throw new globalThis.Error("invalid");
			},
			() => {
				error_called = true;
				throw new globalThis.Error("error");
			},
		);
	});

	assert_truthy(isHttpError(thrown, 404));
	assert_equals(thrown.body, { message: "missing", status: 404 });
	assert_false(invalid_called);
	assert_false(error_called);
});

test("run_remote_effect rethrows SvelteKit validation defects", async () => {
	class TestRuntime {
		runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
			return Effect.runPromise(effect);
		}
	}

	const runtime = new TestRuntime();
	let invalid_called = false;
	let error_called = false;

	const thrown = await assert_rejects(async () => {
		await run_remote_effect(
			Effect.sync(() => svelte_invalid("bad input")),
			runtime,
			() => {
				invalid_called = true;
				throw new globalThis.Error("invalid");
			},
			() => {
				error_called = true;
				throw new globalThis.Error("error");
			},
		);
	});

	assert_truthy(isValidationError(thrown));
	assert_false(invalid_called);
	assert_false(error_called);
});

test("run_live_handler_source converts Effect Streams to async iterables", async () => {
	const source = await run_live_handler_source(Stream.make(1, 2, 3), make_request_event());

	const values: number[] = [];

	for await (const value of source as AsyncIterable<number>) {
		values.push(value);
	}

	assert_equals(values, [1, 2, 3]);
});

test("run_live_handler_source passes through native async iterables", async () => {
	async function* make_source(): AsyncGenerator<string> {
		yield "first";
		yield "second";
	}

	const source = await run_live_handler_source(make_source(), make_request_event());

	const values: string[] = [];

	for await (const value of source as AsyncIterable<string>) {
		values.push(value);
	}

	assert_equals(values, ["first", "second"]);
});

function make_request_event() {
	return {
		cookies: {
			delete() {},
			get() {
				return undefined;
			},
			serialize() {
				return "";
			},
			set() {},
		},
		getClientAddress() {
			return "127.0.0.1";
		},
		locals: {},
		params: {},
		request: new Request("http://localhost/test"),
		route: { id: null },
		url: new URL("http://localhost/test"),
	};
}
