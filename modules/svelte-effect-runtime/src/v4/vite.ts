/**
 * v4-specific low-level Vite entrypoints for `svelte-effect-runtime`.
 *
 * @example
 * ```ts
 * import { sveltekit_effect_runtime } from "svelte-effect-runtime/v4/vite";
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
import { with_v4_effect_preprocess_options } from "$/v4/preprocess.ts";

export type {
  SvelteEffectRuntimeOptions,
  SveltekitEffectRuntimeOptions,
} from "$/v3/vite.ts";

/**
 * Low-level Vite plugin wrapper for non-SvelteKit builds targeting the v4
 * runtime module id.
 *
 * @see https://ser.barekey.dev/content/reference/tooling
 */
export function svelte_effect_runtime(
  options: SvelteEffectRuntimeOptions = {},
): Plugin[] {
  return create_svelte_effect_runtime({
    ...options,
    effect: with_v4_effect_preprocess_options(options.effect),
  });
}

/**
 * Low-level Vite plugin that swaps SvelteKit's generated remote client module
 * for the Effect-aware adapters used by `effect()` when targeting the v4
 * runtime entry.
 *
 * Prefer `effect()` unless you are assembling a custom Vite plugin stack.
 *
 * @see https://ser.barekey.dev/content/reference/tooling
 */
export function sveltekit_effect_runtime(
  options: SveltekitEffectRuntimeOptions = {},
): Plugin {
  return create_sveltekit_effect_runtime(options);
}
