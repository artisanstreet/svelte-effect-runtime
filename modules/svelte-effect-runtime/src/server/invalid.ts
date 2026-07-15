import { create_form_error } from "$/remote/shared.ts";
import type { FormIssue } from "$/remote/shared.ts";
import type { FormInvalid } from "./types.ts";
import { Effect } from "effect";

export function make_invalid_proxy<Input = unknown>(
	path: readonly (string | number)[] = [],
): FormInvalid<Input> {
	const invalid_at_path = (message: string) =>
		Effect.fail(create_form_error([{ message, path: [...path] } satisfies FormIssue]));

	return new Proxy(invalid_at_path, {
		get(_target, property) {
			if (typeof property === "symbol") {
				return undefined;
			}

			const segment = path.length === 0 ? property : normalize_nested_path_segment(property);

			return make_invalid_proxy([...path, segment]);
		},
	}) as FormInvalid<Input>;
}

function normalize_nested_path_segment(property: string): string | number {
	const is_array_index = /^(0|[1-9]\d*)$/.test(property);

	return is_array_index ? Number(property) : property;
}
