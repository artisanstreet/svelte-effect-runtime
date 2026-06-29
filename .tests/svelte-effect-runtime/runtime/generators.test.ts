import { assertEquals, assertExists } from "@std/assert";

Deno.test("generators exports get_dispatcher", async () => {
  const mod = await import(
    "../../../modules/svelte-effect-runtime/src/generators.ts"
  );
  assertExists(mod.get_dispatcher);
  assertEquals(typeof mod.get_dispatcher, "function");
});

Deno.test("generators exports dispatcher event facade", async () => {
  const mod = await import(
    "../../../modules/svelte-effect-runtime/src/generators.ts"
  );

  assertExists(mod.Dispatcher);
  assertEquals(typeof mod.Dispatcher.emit, "function");
  assertEquals(mod.Code.Markup.Promise, "MarkupPromise");
});

Deno.test("generators does NOT export Effect", async () => {
  const mod = await import(
    "../../../modules/svelte-effect-runtime/src/generators.ts"
  );
  if ("Effect" in mod) {
    throw new Error(
      "generators.ts must not re-export Effect. " +
        'The script transform emits `import { Effect } from "effect"` directly.',
    );
  }
});

Deno.test("generators does NOT export onMount", async () => {
  const mod = await import(
    "../../../modules/svelte-effect-runtime/src/generators.ts"
  );
  if ("onMount" in mod) {
    throw new Error(
      "generators.ts must not re-export onMount. " +
        'The script transform emits `import { onMount } from "svelte"` directly.',
    );
  }
});

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}
