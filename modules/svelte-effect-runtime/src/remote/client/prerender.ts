import {
	attach_failed_remote_resource_getters,
	attach_remote_resource_getters,
	type RemoteResourceEffect,
} from "$/remote/resource.ts";
import { InvalidPrerenderFactoryError } from "$/errors.ts";
import { FailWithRemoteError } from "$/remote/effect.ts";
import { copy_property_descriptors } from "./utils.ts";
import { ResolveQueryResult } from "./query-result.ts";
import type { NativeMethod } from "./types.ts";
import { Result } from "effect";

type RemoteInput<Input> = undefined extends Input ? Input | void : Input;

type EffectRemotePrerenderAdapter<Input, Output, ErrorType = never> = (
	input: RemoteInput<Input>,
) => RemoteResourceEffect<Output, ErrorType>;

export function create_remote_prerender_adapter<Input, Output, ErrorType = never>(
	native_factory: unknown,
	decode_payload: (value: unknown) => Output,
): EffectRemotePrerenderAdapter<Input, Output, ErrorType>;
export function create_remote_prerender_adapter<Input, Output, ErrorType = never>(
	native_factory: unknown,
	decode_payload: (value: unknown) => unknown,
): EffectRemotePrerenderAdapter<Input, Output, ErrorType>;
export function create_remote_prerender_adapter<Input, Output, ErrorType = never>(
	native_factory: unknown,
	decode_payload: (value: unknown) => unknown,
): EffectRemotePrerenderAdapter<Input, Output, ErrorType> {
	if (typeof native_factory !== "function") {
		throw new InvalidPrerenderFactoryError();
	}

	const prerender = native_factory as NativeMethod;
	const wrapped = ((input: RemoteInput<Input>) => {
		const resource_attempt = Result.try(() => prerender(input));

		if (Result.isFailure(resource_attempt)) {
			const PrerenderEffect = FailWithRemoteError<ErrorType>(
				resource_attempt.failure,
			) as unknown as RemoteResourceEffect<Output, ErrorType>;

			attach_failed_remote_resource_getters(resource_attempt.failure, PrerenderEffect);

			return PrerenderEffect;
		}

		const resource = resource_attempt.success;
		const PrerenderEffect = ResolveQueryResult<Output, ErrorType>(
			resource,
			decode_payload,
		) as RemoteResourceEffect<Output, ErrorType>;

		attach_remote_resource_getters(resource, PrerenderEffect);

		return PrerenderEffect;
	}) as EffectRemotePrerenderAdapter<Input, Output, ErrorType>;

	copy_property_descriptors(native_factory, wrapped);

	return wrapped;
}
