import {
	Command as ServerCommand,
	Error as ServerError,
	Handler as ServerHandler,
	Prerender as ServerPrerender,
	Query as ServerQuery,
	Redirect as ServerRedirect,
	ServerRuntime,
} from "../../../modules/svelte-effect-runtime/src/server/index.ts";
import {
	encode_remote_failure,
	normalize_remote_helper_error,
	run_remote_effect,
	throw_form_error,
	throw_remote_cause,
} from "../../../modules/svelte-effect-runtime/src/remote/server.ts";
import {
	error as svelte_error,
	invalid as svelte_invalid,
	isHttpError,
	isRedirect,
	isValidationError,
	redirect as svelte_redirect,
} from "@sveltejs/kit";
import {
	assert_false,
	assert_truthy,
	assert_equals,
	assert_throws,
	assert_rejects,
	assert_string_includes,
} from "../unit/helpers/assert.ts";
import {
	reset_test_command,
	reset_test_prerender,
	reset_test_query,
	reset_test_request_event,
	set_test_command,
	set_test_prerender,
	set_test_query,
	set_test_request_event,
} from "../unit/fixtures/app-server.ts";
import {
	get_server_dispatcher,
	reset_server_runtime,
} from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import {
	Error as RootError,
	Redirect as RootRedirect,
} from "../../../modules/svelte-effect-runtime/src/mod.ts";
import { classify_remote_cause } from "../../../modules/svelte-effect-runtime/src/remote/cause-codec.ts";
import { run_live_handler_source } from "../../../modules/svelte-effect-runtime/src/server/effects.ts";
import { InvalidLiveQueryReturnError } from "../../../modules/svelte-effect-runtime/src/errors.ts";
import { create_form_error } from "../../../modules/svelte-effect-runtime/src/remote/shared.ts";
import { Cause, Context, Data, Effect, Exit, Layer, Schema, Stream } from "effect";
import { parse } from "devalue";
import { test } from "vitest";

import * as sveltekit_server from "../../../modules/svelte-effect-runtime/src/internal/sveltekit-server.ts";

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

test("Command calls remain Effect-yieldable outside native remote dispatch", async () => {
	const descriptor = { id: "command" };

	set_test_command((...args) => {
		const handler = args.at(-1) as (input: unknown) => Promise<unknown>;
		const native = (input: unknown) => handler(input);

		Object.defineProperty(native, "__", { value: descriptor });
		Object.defineProperty(native, "pending", { get: () => 0 });

		return native;
	});
	set_test_request_event({
		...make_request_event(),
		isRemoteRequest: false,
		request: new Request("http://localhost/test", { method: "POST" }),
	});

	try {
		const SaveDraft = ServerCommand(Schema.String, (title) => Effect.succeed({ saved: title }));
		const Program = Effect.gen(function* () {
			return yield* SaveDraft("publish");
		});
		const result = await get_server_dispatcher().run(Program);

		assert_equals(result, { saved: "publish" });
		assert_equals(Object.getOwnPropertyDescriptor(SaveDraft, "__")?.value, descriptor);
		assert_equals(SaveDraft.pending, 0);
	} finally {
		reset_test_command();
		reset_test_request_event();
	}
});

test("Command updates unwrap Effect query functions and resources for SvelteKit", async () => {
	const update_targets: unknown[][] = [];
	let native_posts: Promise<unknown> | undefined;
	let native_posts_query: ((input: unknown) => Promise<unknown>) | undefined;

	set_test_query(() => {
		native_posts_query = () => {
			native_posts = Promise.resolve(["one"]);

			return native_posts;
		};

		return native_posts_query;
	});
	set_test_command((...args) => {
		const handler = args.at(-1) as (input: unknown) => Promise<unknown>;

		return (input: unknown) => {
			const result = handler(input) as Promise<unknown> & {
				updates: (...updates: unknown[]) => Promise<unknown>;
			};

			result.updates = (...updates: unknown[]) => {
				update_targets.push(updates);

				return result;
			};

			return result;
		};
	});
	set_test_request_event({
		...make_request_event(),
		isRemoteRequest: false,
		request: new Request("http://localhost/test", { method: "POST" }),
	});

	try {
		const GetPosts = ServerQuery(() => Effect.succeed(["one"]));
		const Posts = GetPosts();
		const SaveDraft = ServerCommand(Schema.String, (title) => Effect.succeed(title));
		const result = await get_server_dispatcher().run(
			SaveDraft("publish").updates(GetPosts, Posts),
		);

		assert_equals(result, "publish");
		assert_equals(update_targets, [[native_posts_query, native_posts]]);
	} finally {
		reset_test_command();
		reset_test_query();
		reset_test_request_event();
	}
});

test("Command remote dispatch preserves the native result while nested Commands stay yieldable", async () => {
	type NativeCommandRecord = {
		readonly descriptor: { readonly index: number };
		result?: Promise<unknown>;
	};

	const records: NativeCommandRecord[] = [];

	set_test_command((...args) => {
		const handler = args.at(-1) as (input: unknown) => Promise<unknown>;
		const record: NativeCommandRecord = {
			descriptor: { index: records.length },
		};
		const native = (input: unknown) => {
			const result = handler(input) as Promise<unknown> & {
				updates: (...updates: unknown[]) => Promise<unknown>;
			};

			result.updates = () => result;
			record.result = result;

			return result;
		};

		Object.defineProperty(native, "__", { value: record.descriptor });
		Object.defineProperty(native, "pending", { get: () => 0 });
		records.push(record);

		return native;
	});
	set_test_request_event({
		...make_request_event(),
		isRemoteRequest: true,
		request: new Request("http://localhost/_app/remote/command", { method: "POST" }),
	});

	try {
		const NormalizeTitle = ServerCommand(Schema.String, (title) =>
			Effect.succeed(title.trim()),
		);
		const SaveDraft = ServerCommand(Schema.String, (title) =>
			Effect.gen(function* () {
				const normalized = yield* NormalizeTitle(title);

				return { saved: normalized };
			}),
		);
		const native_result = SaveDraft("  publish  ") as unknown as Promise<unknown>;

		assert_equals(native_result, records[1]?.result);
		assert_equals(
			Object.getOwnPropertyDescriptor(SaveDraft, "__")?.value,
			records[1]?.descriptor,
		);
		assert_equals(await native_result, { saved: "publish" });
	} finally {
		reset_test_command();
		reset_test_request_event();
	}
});

test("mutative Handler callbacks can yield Command calls", async () => {
	type NativeHandler = () => Promise<Response>;

	set_test_command((...args) => {
		const handler = args.at(-1) as (input: unknown) => Promise<unknown>;

		return (input: unknown) => handler(input);
	});
	set_test_request_event({
		...make_request_event(),
		isRemoteRequest: true,
		request: new Request("http://localhost/posts", { method: "POST" }),
	});

	try {
		const SaveDraft = ServerCommand(Schema.String, (title) => Effect.succeed({ saved: title }));
		const POST = ServerHandler<NativeHandler>(function* () {
			const saved = yield* SaveDraft("publish");

			return Response.json(saved);
		});
		const response = await POST();

		assert_equals(await response.json(), { saved: "publish" });
	} finally {
		reset_test_command();
		reset_test_request_event();
	}
});

test("Prerender calls with an Effect Schema remain Effect-yieldable during SSR", async () => {
	const descriptor = { id: "prerender" };

	set_test_prerender((_validator, wrapped_handler) => {
		const handler = wrapped_handler as (input: unknown) => Promise<unknown>;
		const native = (input: unknown) => handler(input);

		Object.defineProperty(native, "__", { value: descriptor });

		return native;
	});
	set_test_request_event({ ...make_request_event(), isRemoteRequest: false });

	try {
		const ReadStatic = ServerPrerender(Schema.String, (key) => Effect.succeed({ key }), {
			dynamic: true,
		});
		const Program = Effect.gen(function* () {
			return yield* ReadStatic("static");
		});
		const result = await get_server_dispatcher().run(Program);

		assert_equals(result, { key: "static" });
		assert_equals(Object.getOwnPropertyDescriptor(ReadStatic, "__")?.value, descriptor);
	} finally {
		reset_test_prerender();
		reset_test_request_event();
	}
});

test("inputless Prerender calls remain Effect-yieldable during SSR", async () => {
	set_test_prerender((wrapped_handler) => {
		const handler = wrapped_handler as (input: undefined) => Promise<unknown>;

		return () => handler(undefined);
	});
	set_test_request_event({ ...make_request_event(), isRemoteRequest: false });

	try {
		const ReadStatic = ServerPrerender(() => Effect.succeed("static"));
		const Program = Effect.gen(function* () {
			return yield* ReadStatic();
		});

		assert_equals(await get_server_dispatcher().run(Program), "static");
	} finally {
		reset_test_prerender();
		reset_test_request_event();
	}
});

test("Prerender calls preserve SvelteKit resources during remote requests", async () => {
	let native_resource: Promise<unknown> | undefined;

	set_test_prerender((_validator, wrapped_handler) => {
		const handler = wrapped_handler as (input: unknown) => Promise<unknown>;

		return (input: unknown) => {
			native_resource = handler(input);

			return native_resource;
		};
	});
	set_test_request_event({ ...make_request_event(), isRemoteRequest: true });

	try {
		const ReadStatic = ServerPrerender(Schema.String, (key) => Effect.succeed({ key }));
		const result = ReadStatic("static");

		assert_equals(result, native_resource);
		assert_equals(await (result as unknown as Promise<unknown>), { key: "static" });
	} finally {
		reset_test_prerender();
		reset_test_request_event();
	}
});

test("Prerender SSR calls expose state after synchronous native failures", async () => {
	set_test_prerender(() => () => {
		throw new Error("serialization failed");
	});
	set_test_request_event({ ...make_request_event(), isRemoteRequest: false });

	try {
		const ReadStatic = ServerPrerender(Schema.String, (key) => Effect.succeed(key));
		const PrerenderProgram = ReadStatic("static");
		const exit = await get_server_dispatcher().run(Effect.exit(PrerenderProgram));
		const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

		assert_truthy(Exit.isFailure(exit));
		assert_equals((error as { _tag?: string })._tag, "RemoteTransportError");
		assert_equals((PrerenderProgram.error as { _tag?: string })._tag, "RemoteTransportError");
		assert_equals(PrerenderProgram.current, undefined);
		assert_false(PrerenderProgram.loading);
		assert_false(PrerenderProgram.ready);
	} finally {
		reset_test_prerender();
		reset_test_request_event();
	}
});

test("Prerender inputs run lazily through the configured ServerRuntime", async () => {
	type CapturedPrerenderOptions = {
		readonly dynamic?: boolean;
		readonly inputs?: () => unknown;
	};

	const InputCatalog = Context.Service<{ readonly values: readonly string[] }>("InputCatalog");
	let captured_options: CapturedPrerenderOptions | undefined;

	reset_server_runtime();
	set_test_prerender((_validator, _handler, options) => {
		captured_options = options as CapturedPrerenderOptions;

		return () => Promise.resolve("unused");
	});

	try {
		ServerPrerender(Schema.String, (key) => Effect.succeed(key), {
			dynamic: true,
			inputs: () =>
				Effect.gen(function* () {
					const catalog = yield* InputCatalog;

					return catalog.values;
				}),
		});

		assert_truthy(captured_options);
		assert_truthy(captured_options.inputs);
		assert_equals(captured_options.dynamic, true);

		ServerRuntime.make(
			Layer.succeed(InputCatalog, {
				values: ["first", "second"],
			}),
		);

		assert_equals(await captured_options.inputs(), ["first", "second"]);
	} finally {
		reset_server_runtime();
		reset_test_prerender();
	}
});

test("Prerender SSR calls expose tagged domain failures like client calls", async () => {
	const domain_failure = {
		_tag: "DomainError" as const,
		message: "missing",
	};

	set_passthrough_prerender();
	set_test_request_event({ ...make_request_event(), isRemoteRequest: false });

	try {
		const ReadStatic = ServerPrerender(Schema.String, () => Effect.fail(domain_failure));
		const Program = ReadStatic("static").pipe(
			Effect.catchTag("DomainError", (error) => Effect.succeed(error.message)),
		);
		const exit = await get_server_dispatcher().run(Effect.exit(Program));

		assert_truthy(Exit.isSuccess(exit));
		assert_equals(exit.value, "missing");
	} finally {
		reset_test_prerender();
		reset_test_request_event();
	}
});

test("Prerender SSR calls expose SvelteKit HTTP failures as RemoteHttpError", async () => {
	set_passthrough_prerender();
	set_test_request_event({ ...make_request_event(), isRemoteRequest: false });

	try {
		const ReadStatic = ServerPrerender(Schema.String, () => ServerError("NotFound", "missing"));
		const Program = ReadStatic("static").pipe(
			Effect.catchTag("RemoteHttpError", (error) => Effect.succeed(error.status)),
		);
		const exit = await get_server_dispatcher().run(Effect.exit(Program));

		assert_truthy(Exit.isSuccess(exit));
		assert_equals(exit.value, 404);
	} finally {
		reset_test_prerender();
		reset_test_request_event();
	}
});

test("Prerender SSR calls keep redirects on the defect channel", async () => {
	set_passthrough_prerender();
	set_test_request_event({ ...make_request_event(), isRemoteRequest: false });

	try {
		const ReadStatic = ServerPrerender(Schema.String, () => ServerRedirect(303, "/oauth"));
		const exit = await get_server_dispatcher().run(Effect.exit(ReadStatic("static")));

		assert_truthy(Exit.isFailure(exit));

		const redirect_reason = exit.cause.reasons.find(Cause.isDieReason);

		assert_truthy(redirect_reason);
		assert_truthy(isRedirect(redirect_reason.defect));
		assert_equals(redirect_reason.defect.status, 303);
		assert_equals(redirect_reason.defect.location, "/oauth");
	} finally {
		reset_test_prerender();
		reset_test_request_event();
	}
});

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

test("classify_remote_cause preserves SvelteKit control-flow defects", () => {
	let defect: unknown = undefined;

	try {
		svelte_redirect(303, "/oauth");
	} catch (error: unknown) {
		defect = error;
	}

	const resolution = classify_remote_cause(Cause.die(defect));

	assert_equals(resolution._tag, "SvelteKitControlFlow");

	if (resolution._tag !== "SvelteKitControlFlow") {
		throw new Error("expected SvelteKit control flow resolution");
	}

	assert_equals(resolution.value, defect);
});

test("classify_remote_cause preserves interrupt-only causes", () => {
	const cause = Cause.interrupt();
	const resolution = classify_remote_cause(cause);

	assert_equals(resolution._tag, "InterruptOnly");

	if (resolution._tag !== "InterruptOnly") {
		throw new Error("expected interrupt-only resolution");
	}

	assert_equals(resolution.cause, cause);
});

test("classify_remote_cause preserves form validation failures", () => {
	const issues = [{ message: "bad input", path: ["field"] }];
	const resolution = classify_remote_cause(Cause.fail(create_form_error(issues)));

	assert_equals(resolution._tag, "FormInvalid");

	if (resolution._tag !== "FormInvalid") {
		throw new Error("expected form invalid resolution");
	}

	assert_equals(resolution.issues, issues);
});

test("classify_remote_cause preserves tag-only form validation failures", () => {
	const resolution = classify_remote_cause(Cause.fail({ _tag: "FormError" }));

	assert_equals(resolution._tag, "FormInvalid");

	if (resolution._tag !== "FormInvalid") {
		throw new Error("expected form invalid resolution");
	}

	assert_equals(resolution.issues, []);
});

test("classify_remote_cause encodes tagged domain failures", () => {
	const resolution = classify_remote_cause(Cause.fail({ _tag: "DbError", code: 42 }));

	assert_equals(resolution._tag, "RemoteFailure");

	if (resolution._tag !== "RemoteFailure") {
		throw new Error("expected remote failure resolution");
	}

	const parsed = parse(resolution.encoded);

	assert_equals(parsed._tag, "DbError");
	assert_equals(parsed.code, 42);
});

test("encode_remote_failure serialises a tagged error from a Cause", async () => {
	const program = Effect.gen(function* () {
		return yield* Effect.fail({ _tag: "MyError", code: 42 });
	});

	const exit = await get_server_dispatcher().run(Effect.exit(program));
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

	const exit = await get_server_dispatcher().run(Effect.exit(program));
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

test("Error resolves named status aliases", async () => {
	const exit = await get_server_dispatcher().run(Effect.exit(ServerError("NotFound", "missing")));
	const thrown = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_truthy(isHttpError(thrown, 404));
	assert_equals(thrown.body, { message: "missing", status: 404 });
});

test("Error passes numeric statuses through", async () => {
	const exit = await get_server_dispatcher().run(
		Effect.exit(ServerError(418, "short and stout")),
	);
	const thrown = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_truthy(isHttpError(thrown, 418));
	assert_equals(thrown.body, { message: "short and stout", status: 418 });
});

test("Error accepts SvelteKit 3 properties overload", async () => {
	const exit = await get_server_dispatcher().run(
		Effect.exit(ServerError(400, "bad request", {})),
	);
	const thrown = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_truthy(isHttpError(thrown, 400));
	assert_equals(thrown.body, { message: "bad request", status: 400 });
});

test("Redirect resolves named status aliases", async () => {
	const exit = await get_server_dispatcher().run(
		Effect.exit(ServerRedirect("TemporaryRedirect", "/oauth")),
	);
	const thrown = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_truthy(isRedirect(thrown));
	assert_equals(thrown.status, 307);
	assert_equals(thrown.location, "/oauth");
});

test("Redirect passes numeric statuses through", async () => {
	const exit = await get_server_dispatcher().run(Effect.exit(ServerRedirect(303, "/done")));
	const thrown = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
	assert_truthy(isRedirect(thrown));
	assert_equals(thrown.status, 303);
	assert_equals(thrown.location, "/done");
});

test("Redirect passes SvelteKit 3 external options through", async () => {
	const exit = await get_server_dispatcher().run(
		Effect.exit(ServerRedirect(303, "https://example.com/oauth", { external: true })),
	);
	const thrown = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

	assert_equals(Exit.isFailure(exit), true);
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
			return get_server_dispatcher().run(effect);
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
			return get_server_dispatcher().run(effect);
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
			return get_server_dispatcher().run(effect);
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
			return get_server_dispatcher().run(effect);
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
			return get_server_dispatcher().run(effect);
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
			return get_server_dispatcher().run(effect);
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
			return get_server_dispatcher().run(effect);
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
			return get_server_dispatcher().run(effect);
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

test("run_live_handler_source wraps stream failures before the first value", async () => {
	class LiveDomainError extends Data.TaggedError("LiveDomainError")<{
		readonly reason: string;
	}> {}

	const source = await run_live_handler_source(
		Stream.fail(new LiveDomainError({ reason: "before" })),
		make_request_event(),
	);
	const values: unknown[] = [];
	const error = await assert_rejects(async () => {
		for await (const value of source) {
			values.push(value);
		}
	});

	assert_equals(values, []);
	assert_live_failure_envelope(error, "before");
});

test("run_live_handler_source wraps stream failures after emitted values", async () => {
	class LiveDomainError extends Data.TaggedError("LiveDomainError")<{
		readonly reason: string;
	}> {}

	const source = await run_live_handler_source(
		Stream.make("first").pipe(
			Stream.concat(Stream.fail(new LiveDomainError({ reason: "after" }))),
		),
		make_request_event(),
	);
	const iterator = source[Symbol.asyncIterator]();

	assert_equals(await iterator.next(), { done: false, value: "first" });

	const error = await assert_rejects(() => iterator.next());

	assert_live_failure_envelope(error, "after");
});

test("run_live_handler_source preserves redirects before the first value", async () => {
	const source = await run_live_handler_source(
		Stream.fromEffect(ServerRedirect("TemporaryRedirect", "/login")),
		make_request_event(),
	);
	const iterator = source[Symbol.asyncIterator]();
	const error = await assert_rejects(() => iterator.next());

	assert_truthy(isRedirect(error));

	if (isRedirect(error)) {
		assert_equals(error.status, 307);
		assert_equals(error.location, "/login");
	}
});

test("run_live_handler_source preserves HTTP errors after emitted values", async () => {
	const source = await run_live_handler_source(
		Stream.make("first").pipe(
			Stream.concat(Stream.fromEffect(ServerError("NotFound", "missing"))),
		),
		make_request_event(),
	);
	const iterator = source[Symbol.asyncIterator]();

	assert_equals(await iterator.next(), { done: false, value: "first" });

	const error = await assert_rejects(() => iterator.next());

	assert_truthy(isHttpError(error, 404));
});

test("run_live_handler_source preserves control flow from combined stream causes", async () => {
	class LiveDomainError extends Data.TaggedError("LiveDomainError")<{
		readonly reason: string;
	}> {}

	const redirect = assert_throws(() => svelte_redirect(307, "/login"));
	const cause = Cause.combine(
		Cause.fail(new LiveDomainError({ reason: "hidden" })),
		Cause.die(redirect),
	);
	const source = await run_live_handler_source(Stream.failCause(cause), make_request_event());
	const iterator = source[Symbol.asyncIterator]();
	const error = await assert_rejects(() => iterator.next());

	assert_truthy(isRedirect(error));

	if (isRedirect(error)) {
		assert_equals(error.status, 307);
		assert_equals(error.location, "/login");
	}
});

test("run_live_handler_source masks tagged stream defects", async () => {
	const defect = {
		_tag: "SecretLiveDefect",
		secret: "must-not-cross-the-wire",
	};
	const source = await run_live_handler_source(
		Stream.failCause(Cause.die(defect)),
		make_request_event(),
	);
	const iterator = source[Symbol.asyncIterator]();
	const error = await assert_rejects(() => iterator.next());

	assert_truthy(isHttpError(error, 500));

	const body = (error as { body?: unknown }).body as {
		__svelte_effect_remote__: true;
		encoded: string;
	};
	const parsed = parse(body.encoded);

	assert_equals(parsed.message, "[UNKNOWN_REMOTE_FAILURE]: Unknown error");
	assert_false(body.encoded.includes(defect._tag));
	assert_false(body.encoded.includes(defect.secret));
});

test("run_live_handler_source closes scoped streams when throw is injected", async () => {
	let finalized = false;
	const stream = Stream.scoped(
		Stream.fromEffect(
			Effect.acquireRelease(Effect.succeed("first"), () =>
				Effect.sync(() => {
					finalized = true;
				}),
			),
		).pipe(Stream.concat(Stream.never)),
	);
	const source = await run_live_handler_source(stream, make_request_event());

	async function* delegate(): AsyncGenerator<string> {
		yield* source;
	}

	const iterator = delegate();

	assert_equals(await iterator.next(), { done: false, value: "first" });

	await assert_rejects(() => iterator.throw(new globalThis.Error("stop")));

	assert_truthy(finalized);
});

test("run_live_handler_source rejects native async iterables", async () => {
	async function* make_source(): AsyncGenerator<string> {
		yield "first";
		yield "second";
	}

	const error = await assert_rejects(() =>
		run_live_handler_source(make_source() as never, make_request_event()),
	);

	assert_truthy(error instanceof InvalidLiveQueryReturnError);
});

function assert_live_failure_envelope(error: unknown, reason: string): void {
	assert_truthy(isHttpError(error, 500));

	const body = (error as { body?: unknown }).body as {
		__svelte_effect_remote__: true;
		encoded: string;
	};
	const parsed = parse(body.encoded);

	assert_equals(body.__svelte_effect_remote__, true);
	assert_equals(parsed._tag, "LiveDomainError");
	assert_equals(parsed.reason, reason);
}

function set_passthrough_prerender(): void {
	set_test_prerender((_validator, wrapped_handler) => {
		const handler = wrapped_handler as (input: unknown) => Promise<unknown>;

		return (input: unknown) => handler(input);
	});
}

test("an untagged failure is reported with its original error and cause", () => {
	const failure = new Error("database password rejected");
	const reports: string[] = [];

	assert_throws(() =>
		throw_remote_cause(
			{ reasons: [{ _tag: "Fail", error: failure }] } as never,
			() => {
				throw new Error("invalid");
			},
			() => {
				throw new Error("error");
			},
			{ method: "POST", route: "/api/[id]/checkout", url: "/api/7/checkout" },
			(message: string) => reports.push(message),
		),
	);

	const [report] = reports;

	assert_equals(reports.length, 1);
	assert_string_includes(report ?? "", "could not be sent to the client");
	assert_string_includes(report ?? "", "no string `_tag`");
	assert_string_includes(report ?? "", "POST /api/7/checkout (route /api/[id]/checkout)");
	assert_string_includes(report ?? "", "database password rejected");
	assert_string_includes(report ?? "", "Data.TaggedError");
});

test("a transportable tagged failure is not reported", () => {
	const reports: string[] = [];

	assert_throws(() =>
		throw_remote_cause(
			{ reasons: [{ _tag: "Fail", error: { _tag: "DbError", detail: "lost" } }] } as never,
			() => {
				throw new Error("invalid");
			},
			() => {
				throw new Error("error");
			},
			undefined,
			(message: string) => reports.push(message),
		),
	);

	assert_equals(reports.length, 0);
});

test("an interrupted handler is reported as an interrupt", async () => {
	const reports: string[] = [];
	const exit = await get_server_dispatcher().run(Effect.exit(Effect.interrupt));

	assert_throws(() =>
		throw_remote_cause(
			Exit.isFailure(exit) ? exit.cause : ({ reasons: [] } as never),
			() => {
				throw new Error("invalid");
			},
			() => {
				throw new Error("error");
			},
			{ url: "/api/live" },
			(message: string) => reports.push(message),
		),
	);

	const [report] = reports;

	assert_equals(reports.length, 1);
	assert_string_includes(report ?? "", "interrupted before it produced a result");
	assert_string_includes(report ?? "", "/api/live");
});

test("a failure that resists every conversion still reaches SvelteKit's error helper", () => {
	const hostile = Object.create(null) as Record<string, unknown>;

	hostile.toString = () => {
		throw new Error("toString refused");
	};
	hostile.toJSON = () => {
		throw new Error("toJSON refused");
	};
	Object.defineProperty(hostile, Symbol.toPrimitive, {
		value: () => {
			throw new Error("toPrimitive refused");
		},
	});

	let captured_status = 0;

	assert_throws(() =>
		throw_remote_cause(
			{ reasons: [{ _tag: "Fail", error: hostile }] } as never,
			() => {
				throw new Error("invalid");
			},
			(status: number) => {
				captured_status = status;

				throw new Error("error");
			},
			undefined,
			() => {
				throw new Error("reporter exploded");
			},
		),
	);

	/** The diagnostic must not replace the response the handler owes. */
	assert_equals(captured_status, 500);
});

test("a defect with no failure reason still names the thrown value", () => {
	const reports: string[] = [];

	assert_throws(() =>
		throw_remote_cause(
			{ reasons: [{ _tag: "Die", defect: new Error("thrown outside Effect") }] } as never,
			() => {
				throw new Error("invalid");
			},
			() => {
				throw new Error("error");
			},
			undefined,
			(message: string) => reports.push(message),
		),
	);

	const [report] = reports;

	assert_equals(reports.length, 1);
	assert_string_includes(report ?? "", "no failure reason");
	assert_string_includes(report ?? "", "thrown outside Effect");
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
