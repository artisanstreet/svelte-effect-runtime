import { assertEquals } from "@std/assert";
import { Dispatcher } from "../../../modules/svelte-effect-runtime/v2/dispatcher.ts";

// ─── Constructor ─────────────────────────────────────────────

Deno.test("Dispatcher constructs without error", () => {
  const d = new Dispatcher();
  assertEquals(typeof d, "object");
});

// ─── fork ────────────────────────────────────────────────────

Deno.test("fork returns a function (the cleanup handle)", () => {
  const d = new Dispatcher();
  const cleanup = d.fork(null);
  assertEquals(typeof cleanup, "function");
});

Deno.test("calling cleanup does not throw", () => {
  const d = new Dispatcher();
  const cleanup = d.fork(null);
  cleanup();
});

// ─── value ───────────────────────────────────────────────────

Deno.test("value returns the fallback synchronously", () => {
  const d = new Dispatcher();
  const result = d.value({
    id: "test-value",
    deps: [],
    fallback: "loading",
    factory: function* () {
      return "real";
    },
  });
  assertEquals(result, "loading");
});

// ─── promise ─────────────────────────────────────────────────

Deno.test("promise returns a Promise", () => {
  const d = new Dispatcher();
  const result = d.promise({
    id: "test-promise",
    deps: [],
    factory: function* () {
      return 42;
    },
  });
  assertEquals(result instanceof Promise, true);
});

// ─── run ─────────────────────────────────────────────────────

Deno.test("run returns a Promise", () => {
  const d = new Dispatcher();
  const result = d.run(null);
  assertEquals(result instanceof Promise, true);
});

// ─── dispose ─────────────────────────────────────────────────

Deno.test("dispose does not throw", () => {
  const d = new Dispatcher();
  d.dispose();
});

// ─── Multiple forks ──────────────────────────────────────────

Deno.test("multiple fork calls return distinct cleanup handles", () => {
  const d = new Dispatcher();
  const c1 = d.fork(null);
  const c2 = d.fork(null);
  // Both should be callable
  c1();
  c2();
});

// ─── Idempotent cleanup ─────────────────────────────────────

Deno.test("calling cleanup twice does not throw", () => {
  const d = new Dispatcher();
  const cleanup = d.fork(null);
  cleanup();
  cleanup();
});
