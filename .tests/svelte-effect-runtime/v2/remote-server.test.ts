import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Effect } from "effect";
import {
  normalize_remote_helper_error,
  throw_form_error,
  encode_remote_failure,
  run_remote_effect,
} from "../../../modules/svelte-effect-runtime/src/remote/server.ts";
import { create_form_error } from "../../../modules/svelte-effect-runtime/src/remote/shared.ts";

// ─── normalize_remote_helper_error ─────────────────────────────

Deno.test("normalize_remote_helper_error wraps outside-a-route message", () => {
  const err = new Error("Cannot use query outside a route");
  const result = normalize_remote_helper_error(err, "Query");

  assertStringIncludes(result.message, "Query was called outside a .remote.ts file");
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

Deno.test("encode_remote_failure serialises a tagged error from a Cause", () => {
  const program = Effect.gen(function* () {
    return yield* Effect.fail({ _tag: "MyError", code: 42 });
  });

  const exitPromise = Effect.runPromise(Effect.exit(program));
  exitPromise.then((exit: unknown) => {
    const ex = exit as { _tag: string; cause: unknown };
    if (ex._tag === "Failure") {
      const encoded = encode_remote_failure(ex.cause);
      const parsed = JSON.parse(encoded);

      assertEquals(parsed._tag, "MyError");
      assertEquals(parsed.code, 42);
    }
  });
});

Deno.test("encode_remote_failure handles cause with no failures gracefully", () => {
  /** A v4-style Cause with empty reasons array. */
  const cause = { reasons: [] };
  const encoded = encode_remote_failure(cause);
  const parsed = JSON.parse(encoded);

  assertEquals(parsed.message, "Unknown error");
});

// ─── run_remote_effect ─────────────────────────────────────────

Deno.test("run_remote_effect returns the success value", async () => {
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
    () => { invalid_called = true; throw new Error("invalid"); },
    () => { error_called = true; throw new Error("error"); },
  );

  assertEquals(result, 42);
  assert(!invalid_called);
  assert(!error_called);
});

Deno.test("run_remote_effect throws invalid on FormError failure", async () => {
  class TestRuntime {
    runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
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
      (status, body) => { captured_status = status; captured_body = body; throw new Error("invalid"); },
      () => { throw new Error("error"); },
    );
  });

  assertEquals(captured_status, 400);
  assertEquals(captured_body, { issues });
});

Deno.test("run_remote_effect throws error on non-FormError failure", async () => {
  class TestRuntime {
    runPromise(effect: Effect.Effect<unknown, unknown, unknown>): Promise<unknown> {
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
      () => { throw new Error("invalid"); },
      (status, body) => { captured_status = status; captured_body = body; throw new Error("error"); },
    );
  });

  assertEquals(captured_status, 500);
  const body = JSON.parse(captured_body as string);
  assertEquals(body._tag, "DbError");
});
