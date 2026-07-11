import type { RemoteFormInput } from "@sveltejs/kit";

import {
	is_standard_schema,
	normalize_validator,
	type StandardSchema,
} from "$/internal/schema.ts";
import { decode_response_or_value } from "./responses.ts";
import { MakeEffectFromPromise } from "./effect.ts";
import { get_remote_action_id, submit_remote_form } from "./form-transport.ts";
import { copy_property_descriptors, has_method } from "./utils.ts";
import { wrap_enhance_callback } from "./form-enhance.ts";
import type { EffectRemoteForm, NativeFormRecord, NativeMethod } from "./types.ts";

type RemoteInput<Input> = undefined extends Input ? Input | void : Input;

interface RemoteFormAdapterState {
	shared_preflight_schema?: StandardSchema;
}

/**
 * Creates a remote form adapter. The callable preserves SvelteKit's native
 * form descriptors while wrapping `validate`, `enhance`, and programmatic
 * submission in Effect-returning APIs.
 *
 * @example
 * ```ts
 * const createPost = create_remote_form_adapter(nativeForm, (value) => value);
 * yield* createPost.validate({ includeUntouched: true });
 * ```
 *
 * @since 2.0.0
 * @param native_factory - SvelteKit's native form object.
 * @param decode_payload - Function to decode the response payload.
 * @param remote_base - Base URL for SvelteKit's remote endpoint.
 * @param adapter_state - Shared mutable state used to mirror root form
 *   preflight schemas across keyed form instances.
 * @param keyed - Whether this adapter wraps a keyed form instance returned by
 *   SvelteKit's native `for(...)` helper.
 * @returns A callable form function whose properties mirror the native form.
 * @internal
 */
export function create_remote_form_adapter<
	Input extends RemoteFormInput | void,
	Output,
	ErrorType = never,
>(
	native_factory: unknown,
	decode_payload: (value: unknown) => unknown,
	remote_base = "",
	adapter_state: RemoteFormAdapterState = {},
	keyed = false,
): EffectRemoteForm<Input, Output, ErrorType> {
	const form_obj = native_factory as NativeFormRecord;
	let local_preflight_schema: StandardSchema | undefined;

	const submit_effect = (input?: RemoteInput<Input>) =>
		MakeEffectFromPromise<Output, ErrorType>(async () => {
			const can_use_remote_endpoint =
				remote_base.length > 0 && get_remote_action_id(form_obj) !== undefined;

			if (has_method(form_obj, "submit") && !can_use_remote_endpoint) {
				const result = await form_obj.submit(input);

				return await decode_response_or_value<Output>(result, decode_payload);
			}

			return await submit_remote_form<Output>(
				form_obj,
				input,
				decode_payload,
				remote_base,
				local_preflight_schema ?? adapter_state.shared_preflight_schema,
			);
		});

	const callable = ((input?: RemoteInput<Input>) => submit_effect(input)) as EffectRemoteForm<
		Input,
		Output,
		ErrorType
	>;

	copy_property_descriptors(
		form_obj,
		callable,
		new Set(["submit", "validate", "enhance", "for", "preflight"]),
	);

	Object.defineProperty(callable, "submit", {
		configurable: true,
		enumerable: false,
		value: submit_effect,
	});

	if (has_method(form_obj, "validate")) {
		Object.defineProperty(callable, "validate", {
			configurable: true,
			enumerable: false,
			value: (options?: Record<string, unknown>) =>
				MakeEffectFromPromise<void, ErrorType>(async () => {
					await form_obj.validate(normalize_validate_options(form_obj.validate, options));
				}),
		});
	}

	if (has_method(form_obj, "enhance")) {
		Object.defineProperty(callable, "enhance", {
			configurable: true,
			enumerable: false,
			value: (callback?: NativeMethod) =>
				form_obj.enhance(wrap_enhance_callback<Output, ErrorType>(callback)),
		});
	}

	if (has_method(form_obj, "for")) {
		Object.defineProperty(callable, "for", {
			configurable: true,
			enumerable: false,
			value: (key: string | number | boolean) =>
				create_remote_form_adapter<Input, Output, ErrorType>(
					form_obj.for(key),
					decode_payload,
					remote_base,
					adapter_state,
					true,
				),
		});
	}

	if (has_method(form_obj, "preflight")) {
		Object.defineProperty(callable, "preflight", {
			configurable: true,
			enumerable: false,
			value: (schema: unknown) => {
				const normalized_schema = normalize_validator(schema);

				if (is_standard_schema(normalized_schema)) {
					local_preflight_schema = normalized_schema;

					if (!keyed) {
						adapter_state.shared_preflight_schema = normalized_schema;
					}
				}

				form_obj.preflight(normalized_schema);

				return callable;
			},
		});
	}

	return callable;
}

function normalize_validate_options(
	validate: NativeMethod,
	options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!options || !("all" in options) || "includeUntouched" in options) {
		return options;
	}

	const source = Function.prototype.toString.call(validate);
	const uses_stable_option =
		source.includes("includeUntouched") && !/\ball\s*=/.test(source);

	if (!uses_stable_option) {
		return options;
	}

	return {
		...options,
		includeUntouched: options.all,
	};
}
