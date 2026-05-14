/**
 * Main entrypoint for `svelte-effect-runtime`.
 *
 * Re-exports the v3 public surface so that plain
 * `import { ClientRuntime } from "svelte-effect-runtime"` resolves to the
 * stable default runtime. For explicit version targeting see
 * `svelte-effect-runtime/v3` and `svelte-effect-runtime/v4`.
 *
 * @example
 * ```ts
 * import { ClientRuntime, run_component_effect } from "svelte-effect-runtime";
 * import { Effect } from "effect";
 *
 * const runtime = ClientRuntime.make();
 * run_component_effect(runtime, Effect.log("hello from effect"));
 * ```
 *
 * @see https://ser.barekey.dev/
 *
 * @module
 */
export * from "$/v3/mod.ts";
