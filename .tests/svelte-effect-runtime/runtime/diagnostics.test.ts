import { find_svelte_effect_diagnostics } from "../../../modules/svelte-effect-runtime/src/diagnostics.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("diagnostics ignore Effect references inside script and style blocks", () => {
  const source = [
    `<script>`,
    `  const value = { nested: Effect.succeed(1) };`,
    `</script>`,
    `<style>`,
    `  .button { color: red; }`,
    `</style>`,
    `<button onclick={Effect.succeed(1)}>save</button>`,
  ].join("\n");
  const diagnostics = find_svelte_effect_diagnostics(source, "Button.svelte");

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].line, 7);
  assertStringIncludes(diagnostics[0].message, "event attribute");
});

Deno.test("diagnostics scan many markup expressions near linearly", () => {
  const small_source = make_many_markup_expressions(4_000);
  const large_source = make_many_markup_expressions(32_000);

  find_svelte_effect_diagnostics(
    make_many_markup_expressions(10),
    "Warmup.svelte",
  );

  const small_elapsed = measure_diagnostics_elapsed_ms(small_source);
  const large_elapsed = measure_diagnostics_elapsed_ms(large_source);
  const allowed_large_elapsed = small_elapsed * 16 + 500;

  if (large_elapsed > allowed_large_elapsed) {
    throw new Error(
      [
        `expected diagnostics scan to stay near-linear`,
        `small elapsed: ${small_elapsed.toFixed(1)}ms`,
        `large elapsed: ${large_elapsed.toFixed(1)}ms`,
        `allowed large elapsed: ${allowed_large_elapsed.toFixed(1)}ms`,
      ].join("\n"),
    );
  }
});

function measure_diagnostics_elapsed_ms(source: string): number {
  const start = performance.now();

  const diagnostics = find_svelte_effect_diagnostics(source, "Dos.svelte");
  const elapsed = performance.now() - start;

  assertEquals(diagnostics.length, 1);

  return elapsed;
}

function make_many_markup_expressions(count: number): string {
  const repeated_markup = Array.from(
    { length: count },
    () => `<p>{value}</p>`,
  ).join("");

  return `${repeated_markup}<p>{Effect.succeed(1)}</p>`;
}
