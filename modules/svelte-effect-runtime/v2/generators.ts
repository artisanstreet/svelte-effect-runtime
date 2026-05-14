/**
 * Barrel module for preprocessor-generated imports. Exports everything the
 * preprocessor needs to emit into generated code. Users never import this
 * module directly.
 *
 * Note: Effect is NOT re-exported. The preprocessor emits
 * `import { Effect } from "effect"` directly.
 *
 * @since 2.0.0
 * @internal
 */
export { onMount } from "svelte";
export { get_dispatcher } from "./dispatcher.ts";
