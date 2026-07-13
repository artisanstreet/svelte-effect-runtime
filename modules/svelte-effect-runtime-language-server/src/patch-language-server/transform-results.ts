import { scan_svelte_effect_source } from "../../../svelte-effect-runtime/src/compiler/source-scan.ts";
import type { RequiredTransformResult, TransformResult } from "./types.ts";

import MagicString from "magic-string";

/**
 * Result of running a transform at the language-server boundary.
 *
 * @example
 * ```ts
 * const attempt = safe_markup_transform_result(transform, code, filename);
 * if (attempt._tag === "TransformFailed") console.error(attempt.error);
 * ```
 *
 * @since 3.4.6
 */
export type TransformAttempt =
	| {
			_tag: "TransformSucceeded";
			result: RequiredTransformResult;
	  }
	| {
			_tag: "TransformFailed";
			error: unknown;
			result: RequiredTransformResult;
	  };

type TransformFailureResultFactory = (
	error: unknown,
	original_code: string,
	filename: string,
) => RequiredTransformResult;

/**
 * Ensures a runtime transform result has the source map shape required by the
 * language-server document mapper.
 *
 * @example
 * ```ts
 * const normalized = normalize_transform_result(result, code, filename);
 * ```
 *
 * @since 2.0.0
 * @param result - Runtime transform output that may omit a source map for
 *   identity transforms.
 * @param original_code - Original source code passed to the transform, used
 *   when an identity source map must be synthesized.
 * @param filename - Source filename to place in generated source maps.
 * @returns A transform result with a concrete source map.
 */
export function normalize_transform_result(
	result: TransformResult,
	original_code: string,
	filename: string,
): RequiredTransformResult {
	return {
		...result,
		map: result.map ?? create_identity_source_map(original_code, filename),
	};
}

/**
 * Runs a language-server transform without letting recoverable transform
 * failures escape into the Svelte server process.
 *
 * @example
 * ```ts
 * const attempt = safe_transform_result(
 *   () => transform_markup_effect(code, filename),
 *   code,
 *   filename,
 * );
 * ```
 *
 * @since 2.4.0
 * @param transform - Runtime transform callback to execute.
 * @param original_code - Original source code passed to the transform.
 * @param filename - Source filename to place in generated source maps.
 * @param create_failure_result - Factory that turns transform failures into a
 *   virtual result safe for the language server to consume.
 * @returns Tagged transform attempt containing either a normalized result or a
 *   diagnostic fallback result when the runtime transform throws.
 */
export function safe_transform_result(
	transform: () => TransformResult,
	original_code: string,
	filename: string,
	create_failure_result: TransformFailureResultFactory = create_identity_transform_result,
): TransformAttempt {
	try {
		return {
			_tag: "TransformSucceeded",
			result: normalize_transform_result(transform(), original_code, filename),
		};
	} catch (error) {
		return {
			_tag: "TransformFailed",
			error,
			result: create_failure_result(error, original_code, filename),
		};
	}
}

/**
 * Runs a markup transform and turns transform failures into a TypeScript
 * diagnostic statement inside the virtual Svelte document.
 *
 * @example
 * ```ts
 * const attempt = safe_markup_transform_result(
 *   () => transform_markup_effect(code, filename),
 *   code,
 *   filename,
 * );
 * ```
 *
 * @since 3.4.6
 * @param transform - Runtime markup transform callback to execute.
 * @param original_code - Original Svelte source passed to the transform.
 * @param filename - Source filename to place in generated source maps.
 * @returns Tagged transform attempt containing a normalized result or a
 *   virtual Svelte result with an editor-visible transform error diagnostic.
 */
export function safe_markup_transform_result(
	transform: () => TransformResult,
	original_code: string,
	filename: string,
): TransformAttempt {
	return safe_transform_result(
		transform,
		original_code,
		filename,
		create_markup_transform_error_result,
	);
}

/**
 * Runs a script transform and turns transform failures into a TypeScript
 * diagnostic statement inside the virtual script.
 *
 * @example
 * ```ts
 * const attempt = safe_script_transform_result(
 *   () => transform_script_effect(code, filename),
 *   code,
 *   filename,
 * );
 * ```
 *
 * @since 2.4.0
 * @param transform - Runtime script transform callback to execute.
 * @param original_code - Original script source passed to the transform.
 * @param filename - Source filename to place in generated source maps.
 * @returns Tagged transform attempt containing a normalized result or a
 *   virtual script result with an editor-visible transform error diagnostic.
 */
export function safe_script_transform_result(
	transform: () => TransformResult,
	original_code: string,
	filename: string,
): TransformAttempt {
	return safe_transform_result(
		transform,
		original_code,
		filename,
		create_script_transform_error_result,
	);
}

function create_identity_source_map(code: string, filename: string): Record<string, unknown> {
	const magic = new MagicString(code);

	return create_source_map(magic, filename);
}

function create_identity_transform_result(
	_error: unknown,
	code: string,
	filename: string,
): RequiredTransformResult {
	return {
		code,
		map: create_identity_source_map(code, filename),
	};
}

function create_markup_transform_error_result(
	error: unknown,
	original_code: string,
	filename: string,
): RequiredTransformResult {
	const diagnostic_code = make_transform_error_code(error);
	const script_content_start = find_first_script_content_start(original_code);
	const magic = new MagicString(original_code);

	if (script_content_start === undefined) {
		magic.prepend(`<script lang="ts">\n${diagnostic_code}\n</script>\n`);
	} else {
		magic.appendRight(script_content_start, `\n${diagnostic_code}\n`);
	}

	return {
		code: magic.toString(),
		map: create_source_map(magic, filename),
	};
}

function create_script_transform_error_result(
	error: unknown,
	original_code: string,
	filename: string,
): RequiredTransformResult {
	const diagnostic_code = make_transform_error_code(error);
	const magic = new MagicString(original_code);

	magic.prepend(diagnostic_code + "\n");

	return {
		code: magic.toString(),
		map: create_source_map(magic, filename),
	};
}

function make_transform_error_code(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const quoted_message = JSON.stringify(message).replace(/<\/script/gi, "<\\/script");

	return [`const __SER_language_server_transform_error: never =`, `  ${quoted_message};`].join(
		"\n",
	);
}

function find_first_script_content_start(source: string): number | undefined {
	const scan = scan_svelte_effect_source(source);

	return scan.scripts[0]?.content_start;
}

function create_source_map(magic: MagicString, filename: string): Record<string, unknown> {
	return magic.generateMap({
		hires: true,
		includeContent: true,
		source: filename,
	}) as unknown as Record<string, unknown>;
}
