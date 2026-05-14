import { assertExists } from "@std/assert";

Deno.test("generators exports get_dispatcher", async () => {
  const mod = await import("../../../modules/svelte-effect-runtime/src/generators.ts");
  assertExists(mod.get_dispatcher);
  assertEquals(typeof mod.get_dispatcher, "function");
});

Deno.test("generators does NOT export Effect", async () => {
  const mod = await import("../../../modules/svelte-effect-runtime/src/generators.ts");
  if ("Effect" in mod) {
    throw new Error(
      "generators.ts must not re-export Effect. " +
      "The preprocessor emits `import { Effect } from \"effect\"` directly.",
    );
  }
});

Deno.test("generators does NOT export onMount", async () => {
  const mod = await import("../../../modules/svelte-effect-runtime/src/generators.ts");
  if ("onMount" in mod) {
    throw new Error(
      "generators.ts must not re-export onMount. " +
      "The preprocessor emits `import { onMount } from \"svelte\"` directly.",
    );
  }
});

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}
