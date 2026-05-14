/**
 * High-level Vite integration for `svelte-effect-runtime`.
 *
 * @example
 * ```ts
 * import { effect } from "svelte-effect-runtime";
 *
 * export default {
 *   plugins: [effect()],
 * };
 * ```
 *
 * @module
 */
import { preprocess } from "svelte/compiler";
import type { Plugin, PluginOption } from "vite";
import {
  effect_preprocess,
  type EffectPreprocessOptions,
} from "$/v3/preprocess.ts";
import { sveltekit_effect_runtime } from "$/v3/vite.ts";

/** Options for the high-level {@link effect} Vite plugin. */
export interface EffectPluginOptions {
  effect?: EffectPreprocessOptions;
  remoteModuleId?: string;
}

function create_effect_svelte_transform(
  options: EffectPreprocessOptions = {},
): Plugin {
  const preprocessor = effect_preprocess(options);

  return {
    name: "svelte-effect-runtime-transform",
    enforce: "pre",
    async transform(code, id, _options) {
      const filename = id.split("?", 1)[0];
      if (!filename.endsWith(".svelte")) {
        return null;
      }

      const transformed = await preprocess(code, preprocessor, { filename });
      if (transformed.code === code) {
        return null;
      }

      return {
        code: transformed.code,
        ...(transformed.map ? { map: transformed.map as never } : {}),
      };
    },
  };
}

/**
 * Convenience Vite plugin that enables `<script effect>` transforms and wires
 * SvelteKit remote functions to the Effect-aware client adapters.
 *
 * Use this in `vite.config.ts` instead of composing lower-level runtime
 * plugins yourself.
 *
 * @see https://ser.barekey.dev/
 */
export function effect(
  options: EffectPluginOptions = {},
): PluginOption[] {
  const transform_plugin = create_effect_svelte_transform(options.effect);

  return [
    transform_plugin,
    sveltekit_effect_runtime({
      remoteModuleId: options.remoteModuleId,
    }),
  ];
}
