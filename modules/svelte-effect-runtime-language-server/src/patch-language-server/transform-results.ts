import { scan_svelte_effect_source } from "../../../svelte-effect-runtime/src/compiler/source-scan.ts";
import type { RequiredTransformResult, TransformResult } from "./types.ts";

import MagicString from "magic-string";

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
