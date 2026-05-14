/**
 * Language-server-facing exports used to apply the `svelte-effect-runtime`
 * transforms inside editor tooling.
 *
 * @module
 */
export { effect_preprocess } from "$/preprocess.ts";
export { transformEffectMarkup as transform_effect_markup } from "$internal/markup.ts";
export { transformEffectScript as transform_effect_script } from "$internal/transform.ts";
