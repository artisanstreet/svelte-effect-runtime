import { type MarkupTransformTarget, transform_markup_effect } from "$/markup/transform.ts";
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
	const script = find_script(content);

	let combined = content;

	if (script?.has_effect) {
		const result = transform_script_effect(script.text, filename, {
			emit_types: script.is_typescript,
		});

		combined =
			content.slice(0, script.effect_attr_start) +
			content.slice(script.effect_attr_end, script.open_end) +
			result.code +
			content.slice(script.close_start);
	}

	const result = transform_markup_effect(combined, filename, {
		target: options.target,
	});

	return { code: result.code };
}

function find_script(content: string):
	| {
			text: string;
			open_end: number;
			close_start: number;
			has_effect: boolean;
			effect_attr_start: number;
			effect_attr_end: number;
			is_typescript: boolean;
	  }
	| undefined {
	const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

	for (const match of content.matchAll(pattern)) {
		if (match.index === undefined || /\bmodule\b/.test(match[1] ?? "")) {
			continue;
		}

		const attrs = match[1] ?? "";
		const effect_match = /\s+effect(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/.exec(attrs);
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
			is_typescript: has_typescript_lang(attrs),
		};
	}

	return undefined;
}

function has_typescript_lang(attrs: string): boolean {
	const lang_match = /\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
	const lang = (lang_match?.[1] ?? lang_match?.[2] ?? lang_match?.[3] ?? "").toLowerCase();

	return lang === "ts" || lang === "typescript";
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
