import { transform_markup_effect } from "$/markup/transform.ts";
import { transform_script_effect } from "$/preprocess.ts";

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
      const script = find_script(content);

      let combined = content;

      if (script?.has_effect) {
        const result = transform_script_effect(script.text, resolved_filename);

        combined = content.slice(0, script.effect_attr_start) +
          content.slice(script.effect_attr_end, script.open_end) +
          result.code +
          content.slice(script.close_start);
      }

      const result = transform_markup_effect(combined, resolved_filename);

      return { code: result.code };
    },
  };
}

function find_script(content: string):
  | {
    text: string;
    open_end: number;
    close_start: number;
    has_effect: boolean;
    effect_attr_start: number;
    effect_attr_end: number;
  }
  | undefined {
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined || /\bmodule\b/.test(match[1] ?? "")) {
      continue;
    }

    const attrs = match[1] ?? "";
    const effect_match = /\s+effect(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/
      .exec(attrs);
    const open_end = match.index + match[0].indexOf(">") + 1;
    const attr_start = effect_match?.index ?? attrs.length;
    const attr_end = attr_start + (effect_match?.[0].length ?? 0);

    return {
      text: match[2],
      open_end,
      close_start: match.index + match[0].lastIndexOf("<"),
      has_effect: effect_match !== null,
      effect_attr_start: match.index + "<script".length + attr_start,
      effect_attr_end: match.index + "<script".length + attr_end,
    };
  }

  return undefined;
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
