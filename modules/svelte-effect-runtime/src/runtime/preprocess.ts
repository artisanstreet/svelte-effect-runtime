import { transform_script_effect } from "$/preprocess.ts";
import { transform_svelte_effect } from "./transform.ts";

/**
 * Result returned by the Svelte markup preprocessor hook.
 *
 * @since 2.0.0
 */
interface MarkupResult {
  code: string;
}

/**
 * Minimal Svelte preprocessor group shape used by the runtime.
 *
 * @since 2.0.0
 */
interface PreprocessGroup {
  name: string;
  markup(options: { content: string; filename?: string }): MarkupResult;
}

/**
 * Svelte preprocessor that lowers `yield*` in script and markup blocks.
 *
 * @example
 * ```js
 * import { preprocess } from "svelte-effect-runtime";
 *
 * export default {
 *   preprocess: [preprocess()],
 * };
 * ```
 *
 * @since 2.0.0
 * @returns A Svelte preprocessor group with a `markup` hook.
 */
export function preprocess(): PreprocessGroup {
  return {
    name: "svelte-effect-runtime",

    markup({ content, filename }: { content: string; filename?: string }) {
      const resolved_filename = filename ?? "unknown.svelte";
      const result = transform_svelte_effect(content, resolved_filename);

      return { code: result.code };
    },
  };
}

export {
  type BlockRef,
  type ScriptTransformResult,
  transform_script_effect,
} from "$/preprocess.ts";

export {
  type MarkupTransformResult,
  transform_markup_effect,
} from "$/markup/transform.ts";

export {
  type SvelteTransformResult,
  transform_svelte_effect,
} from "./transform.ts";
