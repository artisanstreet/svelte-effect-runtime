import { assertExists, assertStringIncludes, assertThrows } from "@std/assert";

// Test that the generators module exports the expected symbols.
// This test exercises the actual exports, not just type assertions.

Deno.test("generators exports get_dispatcher", async () => {
  const mod = await import("../../../modules/svelte-effect-runtime/src/v2/generators.ts");
  assertExists(mod.get_dispatcher);
  assertEquals(typeof mod.get_dispatcher, "function");
});

Deno.test("generators exports onMount (re-exported from svelte)", async () => {
  const mod = await import("$/v2/generators.ts");
  assertExists(mod.onMount);
  assertEquals(typeof mod.onMount, "function");
});

Deno.test("generators does NOT export Effect", async () => {
  const mod = await import("$/v2/generators.ts");
  // Effect must not be re-exported — user code imports it from "effect" directly
  if ("Effect" in mod) {
    throw new Error(
      "generators.ts must not re-export Effect. " +
      "The preprocessor emits `import { Effect } from \"effect\"` directly.",
    );
  }
});

// Helper
function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}
