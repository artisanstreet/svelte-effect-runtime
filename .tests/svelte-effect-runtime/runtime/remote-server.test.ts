import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
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

// ─── normalize_remote_helper_error ─────────────────────────────

Deno.test("normalize_remote_helper_error wraps outside-a-route message", () => {
  const err = new Error("Cannot use query outside a route");
  const result = normalize_remote_helper_error(err, "Query");

  assertStringIncludes(
    result.message,
    "Query was called outside a .remote.ts file",
  );
});

Deno.test("normalize_remote_helper_error preserves other error messages", () => {
  const err = new Error("something else");
  const result = normalize_remote_helper_error(err, "Command");

  assertEquals(result, err);
  assertEquals(result.message, "something else");
});

Deno.test("normalize_remote_helper_error wraps non-Error values", () => {
  const result = normalize_remote_helper_error("raw string", "Form");

  assert(result instanceof Error);
  assertEquals(result.message, "raw string");
});

// ─── throw_form_error ──────────────────────────────────────────

Deno.test("throw_form_error calls invalid with issues and 400 status", () => {
  let captured_status = 0;
  let captured_body: unknown = null;

  const invalid = (status: number, body: unknown): never => {
    captured_status = status;
    captured_body = body;
    throw new Error("invalid called");
  };

  try {
    throw_form_error(
      [{ message: "bad input", path: ["field"] }],
      invalid,
    );
  } catch {
    assertEquals(captured_status, 400);
    assertEquals(captured_body, {
      issues: [{ message: "bad input", path: ["field"] }],
    });
  }
});

// ─── encode_remote_failure ─────────────────────────────────────

Deno.test("encode_remote_failure serialises a tagged error from a Cause", async () => {
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

  assertEquals(parsed._tag, "MyError");
  assertEquals(parsed.code, 42);
});

Deno.test("encode_remote_failure serialises Effect tagged error instances", async () => {
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

  assertEquals(parsed._tag, "AuthenticationError");
  assertEquals(parsed.message, "OAuth is currently disabled");
  assertEquals(parsed.reason, "development");
});

Deno.test("encode_remote_failure handles cause with no failures gracefully", () => {
  /** A v4-style Cause with empty reasons array. */
  const cause = { reasons: [] };
  const encoded = encode_remote_failure(cause);
  const parsed = parse(encoded);

  assertEquals(parsed.message, "Unknown error");
});

// ─── run_remote_effect ─────────────────────────────────────────

Deno.test("Error resolves named status aliases", async () => {
  const thrown = await assertRejects(() =>
    Effect.runPromise(ServerError("NotFound", "missing"))
  );

  assert(isHttpError(thrown, 404));
  assertEquals(thrown.body, { message: "missing" });
});

Deno.test("Error passes numeric statuses through", async () => {
  const thrown = await assertRejects(() =>
    Effect.runPromise(ServerError(418, "short and stout"))
  );

  assert(isHttpError(thrown, 418));
  assertEquals(thrown.body, { message: "short and stout" });
});

Deno.test("Redirect resolves named status aliases", async () => {
  const thrown = await assertRejects(() =>
    Effect.runPromise(ServerRedirect("TemporaryRedirect", "/oauth"))
  );

  assert(isRedirect(thrown));
  assertEquals(thrown.status, 307);
  assertEquals(thrown.location, "/oauth");
});

Deno.test("Redirect passes numeric statuses through", async () => {
  const thrown = await assertRejects(() =>
    Effect.runPromise(ServerRedirect(303, "/done"))
  );

  assert(isRedirect(thrown));
  assertEquals(thrown.status, 303);
  assertEquals(thrown.location, "/done");
});

Deno.test("control-flow helpers type-check in Effect generators", () => {
  const server_error_program = Effect.gen(function* () {
    return yield* ServerError("NotFound", "missing");
  });

  const server_redirect_program = Effect.gen(function* () {
    return yield* ServerRedirect("SeeOther", "/done");
  });

  const root_error_program = Effect.gen(function* () {
    return yield* RootError("NotFound", "missing");
  });

  const root_redirect_program = Effect.gen(function* () {
    return yield* RootRedirect("SeeOther", "/done");
  });

  assert(Effect.isEffect(server_error_program));
  assert(Effect.isEffect(server_redirect_program));
  assert(Effect.isEffect(root_error_program));
  assert(Effect.isEffect(root_redirect_program));
});

Deno.test("run_remote_effect returns the success value", async () => {
  class TestRuntime {
    runPromise(
      effect: Effect.Effect<unknown, unknown, unknown>,
    ): Promise<unknown> {
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

  assertEquals(result, 42);
  assert(!invalid_called);
  assert(!error_called);
});

Deno.test("run_remote_effect throws invalid on FormError failure", async () => {
  class TestRuntime {
    runPromise(
      effect: Effect.Effect<unknown, unknown, unknown>,
    ): Promise<unknown> {
      return Effect.runPromise(effect);
    }
  }

  const runtime = new TestRuntime();
  const issues = [{ message: "bad", path: ["x"] }];
  const form_error = create_form_error(issues);

  let captured_status = 0;
  let captured_body: unknown = null;

  await assertRejects(async () => {
    await run_remote_effect(
      Effect.fail(form_error) as Effect.Effect<number, unknown>,
      runtime,
      (status, body) => {
        captured_status = status;
        captured_body = body;
        throw new Error("invalid");
      },
      () => {
        throw new Error("error");
      },
    );
  });

  assertEquals(captured_status, 400);
  assertEquals(captured_body, { issues });
});

Deno.test("run_remote_effect throws error on non-FormError failure", async () => {
  class TestRuntime {
    runPromise(
      effect: Effect.Effect<unknown, unknown, unknown>,
    ): Promise<unknown> {
      return Effect.runPromise(effect);
    }
  }

  const runtime = new TestRuntime();

  let captured_status = 0;
  let captured_body: unknown = null;

  await assertRejects(async () => {
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

  assertEquals(captured_status, 500);
  const body = captured_body as {
    __svelte_effect_remote__: true;
    encoded: string;
  };
  const parsed = parse(body.encoded);

  assertEquals(body.__svelte_effect_remote__, true);
  assertEquals(parsed._tag, "DbError");
});

Deno.test("run_remote_effect rethrows SvelteKit redirect defects", async () => {
  class TestRuntime {
    runPromise(
      effect: Effect.Effect<unknown, unknown, unknown>,
    ): Promise<unknown> {
      return Effect.runPromise(effect);
    }
  }

  const runtime = new TestRuntime();
  let invalid_called = false;
  let error_called = false;

  const thrown = await assertRejects(async () => {
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

  assert(isRedirect(thrown));
  assertEquals(thrown.status, 303);
  assertEquals(thrown.location, "/oauth");
  assertFalse(invalid_called);
  assertFalse(error_called);
});

Deno.test("run_remote_effect rethrows SvelteKit HTTP error defects", async () => {
  class TestRuntime {
    runPromise(
      effect: Effect.Effect<unknown, unknown, unknown>,
    ): Promise<unknown> {
      return Effect.runPromise(effect);
    }
  }

  const runtime = new TestRuntime();
  let invalid_called = false;
  let error_called = false;

  const thrown = await assertRejects(async () => {
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

  assert(isHttpError(thrown, 404));
  assertEquals(thrown.body, { message: "missing" });
  assertFalse(invalid_called);
  assertFalse(error_called);
});

Deno.test("run_remote_effect rethrows SvelteKit validation defects", async () => {
  class TestRuntime {
    runPromise(
      effect: Effect.Effect<unknown, unknown, unknown>,
    ): Promise<unknown> {
      return Effect.runPromise(effect);
    }
  }

  const runtime = new TestRuntime();
  let invalid_called = false;
  let error_called = false;

  const thrown = await assertRejects(async () => {
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

  assert(isValidationError(thrown));
  assertFalse(invalid_called);
  assertFalse(error_called);
});

Deno.test("run_live_handler_source converts Effect Streams to async iterables", async () => {
  const source = await run_live_handler_source(
    Stream.make(1, 2, 3),
    make_request_event(),
  );

  const values: number[] = [];

  for await (const value of source as AsyncIterable<number>) {
    values.push(value);
  }

  assertEquals(values, [1, 2, 3]);
});

Deno.test("run_live_handler_source passes through native async iterables", async () => {
  async function* make_source(): AsyncGenerator<string> {
    yield "first";
    yield "second";
  }

  const source = await run_live_handler_source(
    make_source(),
    make_request_event(),
  );

  const values: string[] = [];

  for await (const value of source as AsyncIterable<string>) {
    values.push(value);
  }

  assertEquals(values, ["first", "second"]);
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
