/**
 * Barrel module for transform-generated imports. Exports everything the
 * transform needs to emit into generated code. Users never import this
 * module directly.
 *
 * Note: `Effect` is NOT re-exported. The script transform emits
 * `import { Effect } from "effect"` directly. `onMount` is NOT re-exported
 * either; it comes from `"svelte"` directly.
 *
 * @since 2.0.0
 * @internal
 */
export { Code, Dispatcher, get_dispatcher } from "$/generated/dispatcher.ts";
export { ToEffect } from "$/yieldable.ts";
export type {
	DispatcherEvent,
	MarkupPromiseEvent,
	MarkupPromiseOptions,
	MarkupRunEvent,
	MarkupValueEvent,
} from "$/generated/dispatcher.ts";
export type { YieldSuccess } from "$/yieldable.ts";
export { value } from "$/markup/value.ts";
export { promise } from "$/markup/promise.ts";
export { run } from "$/markup/run.ts";
