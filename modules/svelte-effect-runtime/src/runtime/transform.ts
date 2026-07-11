import { type MarkupTransformTarget, transform_markup_effect } from "$/markup/transform.ts";
import { scan_svelte_effect_source } from "$/compiler/source-scan.ts";
import { transform_script_effect } from "$/script-transform/index.ts";

/**
 * Result returned by the direct whole-file Svelte transform.
 *
 * @example
 * ```ts
 * const result = transform_svelte_effect("<p>{yield* load()}</p>", "App.svelte");
 * result.code;
 * ```
 *
 * @since 2.5.0
 */
export interface SvelteTransformResult {
	/** Transformed Svelte source. */
	code: string;
}

/**
 * Options accepted by the direct whole-file Svelte transform.
 *
 * @example
 * ```ts
 * const options: SvelteTransformOptions = { target: "client" };
 * ```
 *
 * @since 2.5.0
 */
export interface SvelteTransformOptions {
	/** Markup emission target passed through to the markup transform. */
	target?: MarkupTransformTarget;
}

/**
 * Lowers SER syntax in a complete Svelte component without using Svelte's
 * adapter API.
 *
 * @example
 * ```ts
 * const result = transform_svelte_effect(
 *   "<script effect>const value = yield* load()</script>",
 *   "App.svelte",
 * );
 * ```
 *
 * @since 2.5.0
 * @param content - Full Svelte component source to lower before Svelte parses
 *   it.
 * @param filename - Component filename used in generated cache identifiers and
 *   diagnostics.
 * @param options - Optional target configuration for markup lowering.
 * @returns The transformed component source.
 */
export function transform_svelte_effect(
	content: string,
	filename = "unknown.svelte",
	options: SvelteTransformOptions = {},
): SvelteTransformResult {
	const scan = scan_svelte_effect_source(content, filename);
	const script = scan.effect_script;

	let combined = content;

	if (script) {
		const effect_attribute = script.effect_attribute;
		const effect_attribute_start = effect_attribute?.start ?? script.opening_tag_end;
		const effect_attribute_end = effect_attribute?.end ?? script.opening_tag_end;
		const result = transform_script_effect(script.text, filename, {
			emit_types: script.is_typescript,
		});

		combined =
			content.slice(0, effect_attribute_start) +
			content.slice(effect_attribute_end, script.opening_tag_end) +
			result.code +
			content.slice(script.closing_tag_start);
	}

	const result = transform_markup_effect(combined, filename, {
		target: options.target,
	});

	return { code: result.code };
}

export {
	type MarkupTransformOptions,
	type MarkupTransformResult,
	type MarkupTransformTarget,
	transform_markup_effect,
} from "$/markup/transform.ts";

export {
	type BlockRef,
	type ScriptTransformResult,
	transform_script_effect,
} from "$/script-transform/index.ts";
