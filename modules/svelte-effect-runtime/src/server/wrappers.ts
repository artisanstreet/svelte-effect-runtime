import type {
	EffectLike,
	RemoteFormHandler,
	RemoteHandler,
	RemoteLiveHandler,
	RemoteLiveSource,
} from "./types.ts";
import { run_handler_effect, run_live_handler, ToEffect } from "./effects.ts";
import { getRequestEvent as get_native_request_event } from "$app/server";
import { normalize_remote_helper_error } from "$/remote/server.ts";
import { make_invalid_proxy } from "./invalid.ts";
import type { RequestEvent } from "./runtime.ts";
import { is_handler } from "./schema.ts";
import { Effect } from "effect";

export { is_running_remote_effect_handler } from "./remote-handler-context.ts";

export function make_remote_wrapper(
	handler: RemoteHandler<unknown, unknown, unknown, unknown> | EffectLike,
	helper_name: string,
): (input: unknown) => Promise<unknown> {
	return async (input: unknown) => {
		let event: RequestEvent;

		try {
			event = get_native_request_event() as unknown as RequestEvent;
		} catch (error: unknown) {
			throw normalize_remote_helper_error(error, helper_name);
		}

		const HandlerEffect = Effect.suspend(() => {
			const result = is_handler(handler) ? handler(input) : handler;

			return ToEffect(result);
		});

		return await run_handler_effect(HandlerEffect, event);
	};
}

export function make_remote_live_wrapper<Input, A>(
	handler: RemoteLiveSource<A, unknown, unknown> | RemoteLiveHandler<Input, A, unknown, unknown>,
	helper_name: string,
): (input: unknown) => Promise<unknown> {
	return async (input: unknown) => {
		let event: RequestEvent;

		try {
			event = get_native_request_event() as unknown as RequestEvent;
		} catch (error: unknown) {
			throw normalize_remote_helper_error(error, helper_name);
		}

		return await run_live_handler(
			() => (typeof handler === "function" ? handler(input as Input) : handler),
			event,
		);
	};
}

export function make_remote_form_wrapper<Input, A>(
	handler: RemoteFormHandler<Input, A, unknown, unknown>,
	helper_name: string,
): (data: unknown, issue: unknown) => Promise<unknown> {
	return async (data: unknown, issue: unknown) => {
		let event: RequestEvent;

		try {
			event = get_native_request_event() as unknown as RequestEvent;
		} catch (error: unknown) {
			throw normalize_remote_helper_error(error, helper_name);
		}

		const HandlerEffect = Effect.suspend(() => {
			const invalid_proxy = make_invalid_proxy<Input>();
			const result = handler({
				data: data as Input,
				invalid: invalid_proxy,
				issue,
			});

			return ToEffect(result);
		});

		return await run_handler_effect(HandlerEffect, event);
	};
}
