/**
 * Low-level Svelte preprocessing primitives for `svelte-effect-runtime`.
 *
 * @example
 * ```ts
 * import { effect_preprocess } from "svelte-effect-runtime/preprocess";
 *
 * const preprocess = effect_preprocess();
 * ```
 *
 * @module
 */
import type { PreprocessorGroup } from "svelte/compiler";
import { transformEffectMarkup } from "$internal/markup.ts";
import { transformEffectScript } from "$internal/transform.ts";

/** Options that control how generated helper imports are emitted. */
export interface EffectPreprocessOptions {
  runtimeModuleId?: string;
  effectModuleId?: string;
  svelteModuleId?: string;
}

const EMPTY_MAP = {
  version: 3,
  sources: [],
  names: [],
  mappings: "",
};

/**
 * Low-level Svelte preprocessor for `<script effect>` and supported markup
 * `yield*` transforms.
 *
 * Advanced entry point used by tooling and custom build setups.
 *
 * @see https://ser.barekey.dev/content/reference/preprocess
 */
export function effect_preprocess(
  options: EffectPreprocessOptions = {},
): PreprocessorGroup {
  return {
    name: "svelte-effect-runtime",
    markup({ content, filename }) {
      const transformed = transformEffectMarkup(content, {
        ...options,
        filename: filename ?? "Component.svelte",
      });

      if (transformed.code === content) {
        return;
      }

      return {
        code: transformed.code,
        map: transformed.map,
      };
    },
    script({ content, attributes, filename }) {
      if (
        attributes.context === "module" || !Object.hasOwn(attributes, "effect")
      ) {
        return;
      }

      const { effect: _effect, ...nextAttributes } = attributes;
      const transformed = transformEffectScript(content, {
        ...options,
        filename: filename ?? "Component.svelte",
      });

      return {
        code: transformed.code,
        map: EMPTY_MAP,
        attributes: nextAttributes,
      };
    },
  };
}
