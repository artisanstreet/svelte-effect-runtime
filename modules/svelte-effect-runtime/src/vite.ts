/**
 * Public Vite entrypoint wrappers for `svelte-effect-runtime`.
 *
 * @example
 * ```ts
 * import { sveltekit_effect_runtime } from "svelte-effect-runtime/vite";
 *
 * export default {
 *   plugins: [sveltekit_effect_runtime()],
 * };
 * ```
 *
 * @module
 */
import type { Plugin } from "vite";
import {
  svelte_effect_runtime as create_svelte_effect_runtime,
  type SvelteEffectRuntimeOptions,
  sveltekit_effect_runtime as create_sveltekit_effect_runtime,
  type SveltekitEffectRuntimeOptions,
} from "$/v3/vite.ts";

export type {
  SvelteEffectRuntimeOptions,
  SveltekitEffectRuntimeOptions,
} from "$/v3/vite.ts";

/**
 * Compose the low-level Svelte preprocessor directly into a plain Vite +
 * Svelte project.
 *
 * @see https://ser.barekey.dev/content/reference/tooling
 */
export function svelte_effect_runtime(
  options?: SvelteEffectRuntimeOptions,
): Plugin[] {
  return create_svelte_effect_runtime(options);
}

/**
 * Install the remote-function adapter that rewrites SvelteKit remote helpers
 * to return `Effect` values.
 *
 * @see https://ser.barekey.dev/content/reference/tooling
 */
export function sveltekit_effect_runtime(
  options?: SveltekitEffectRuntimeOptions,
): Plugin {
  return create_sveltekit_effect_runtime(options);
}
