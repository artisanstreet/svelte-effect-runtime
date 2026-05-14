/**
 * Public API surface for `svelte-effect-runtime`.
 *
 * @module
 */
export { Dispatcher, type Dispose, type PromiseOptions, type ValueOptions } from "./dispatcher.ts";
export { get_dispatcher } from "./dispatcher.ts";
export { type BlockRef, type MarkupTransformResult, type ScriptTransformResult, transform_markup_effect, transform_script_effect } from "./preprocess.ts";
export { contains_top_level_yield_star, is_function_boundary } from "./detect.ts";
export { type Extraction, extract_yield_stars } from "./lowering.ts";
export { PreprocessError, TopLevelAwaitError, YieldStarInRuneError } from "./error.ts";
