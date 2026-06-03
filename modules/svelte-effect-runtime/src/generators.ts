/**
 * Barrel module for preprocessor-generated imports. Exports everything the
 * preprocessor needs to emit into generated code. Users never import this
 * module directly.
 *
 * Note: `Effect` is NOT re-exported. The preprocessor emits
 * `import { Effect } from "effect"` directly. `onMount` is NOT re-exported
 * either — it comes from `"svelte"` directly.
 *
 * @since 2.0.0
 * @internal
 */
export { get_dispatcher } from "$/dispatcher.ts";
export { value } from "$/markup/value.ts";
export { promise } from "$/markup/promise.ts";
export { run } from "$/markup/run.ts";
