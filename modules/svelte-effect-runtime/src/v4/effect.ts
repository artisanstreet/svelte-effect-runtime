/**
 * v4-targeted high-level Vite integration for `svelte-effect-runtime`.
 *
 * @example
 * ```ts
 * import { effect } from "svelte-effect-runtime/v4";
 *
 * export default {
 *   plugins: [effect()],
 * };
 * ```
 *
 * @module
 */
import type { PluginOption } from "vite";
import {
  effect as create_effect_plugin,
  type EffectPluginOptions,
} from "$/v3/effect.ts";
import { with_v4_effect_preprocess_options } from "$/v4/preprocess.ts";

export type { EffectPluginOptions } from "$/v3/effect.ts";

/**
 * v4-flavoured convenience Vite plugin that enables `<script effect>`
 * transforms and Effect-aware remote function adapters.
 *
 * @see https://ser.barekey.dev/
 */
export function effect(
  options: EffectPluginOptions = {},
): PluginOption[] {
  return create_effect_plugin({
    ...options,
    effect: with_v4_effect_preprocess_options(options.effect),
  });
}
