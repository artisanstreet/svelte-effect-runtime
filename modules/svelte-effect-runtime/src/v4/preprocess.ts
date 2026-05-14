/**
 * v4-specific preprocess entrypoints and helpers.
 *
 * @example
 * ```ts
 * import { effect_preprocess } from "svelte-effect-runtime/v4/preprocess";
 *
 * const preprocess = effect_preprocess();
 * ```
 *
 * @module
 */
import type { PreprocessorGroup } from "svelte/compiler";
import {
  effect_preprocess as create_effect_preprocess,
  type EffectPreprocessOptions,
} from "$/v3/preprocess.ts";

export type { EffectPreprocessOptions } from "$/v3/preprocess.ts";

export const V4_RUNTIME_MODULE_ID = "svelte-effect-runtime/v4";

/**
 * Apply the default v4 runtime module id to a preprocess options bag.
 *
 * @internal Internal — do not use.
 */
export function with_v4_effect_preprocess_options(
  options: EffectPreprocessOptions = {},
): EffectPreprocessOptions {
  return {
    ...options,
    runtimeModuleId: options.runtimeModuleId ?? V4_RUNTIME_MODULE_ID,
  };
}

/**
 * Low-level Svelte preprocessor for the v4 runtime entry.
 *
 * Advanced entry point used by tooling and custom build setups.
 *
 * @see https://ser.barekey.dev/content/reference/preprocess
 */
export function effect_preprocess(
  options: EffectPreprocessOptions = {},
): PreprocessorGroup {
  return create_effect_preprocess(with_v4_effect_preprocess_options(options));
}

/**
 * Backwards-compatible camelCase alias retained for older downstream imports.
 */
export const effectPreprocess = effect_preprocess;
