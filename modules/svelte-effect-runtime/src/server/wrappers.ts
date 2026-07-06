import { getRequestEvent as get_native_request_event } from "$app/server";
import { normalize_remote_helper_error } from "$/remote/server.ts";

import { run_handler_effect, run_live_handler_source } from "./effects.ts";
import { make_invalid_proxy } from "./invalid.ts";
import { is_handler } from "./schema.ts";
import type { RequestEvent } from "./runtime.ts";
import type { EffectLike, RemoteFormHandler, RemoteHandler, RemoteLiveHandler } from "./types.ts";

let running_remote_effect_handlers = 0;

/**
 * Reports whether SER is currently executing user remote handler code.
 *
 * @example
 * ```ts
 * if (is_running_remote_effect_handler()) {
 *   return query();
 * }
 * ```
 *
 * @since 2.0.0
 * @returns Whether a remote handler wrapper is currently active.
 * @internal
 */
export function is_running_remote_effect_handler(): boolean {
	return running_remote_effect_handlers > 0;
}

/**
 * Builds the wrapper passed to native query, command, and prerender helpers.
 *
 * @since 2.0.0
 * @param handler - Effect handler or already-built Effect-like value.
 * @param helper_name - Remote helper name for error normalization.
 * @returns Native SvelteKit handler wrapper.
 */
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

		return await run_inside_remote_effect_handler(() => {
			try {
				const result = is_handler(handler) ? handler(input) : handler;

				return run_handler_effect(result, event);
			} catch (error: unknown) {
				throw normalize_remote_helper_error(error, helper_name);
			}
		});
	};
}

/**
 * Builds the wrapper passed to native live query helpers.
 *
 * @since 2.0.0
 * @param handler - Effect-aware live source handler.
 * @param helper_name - Remote helper name for error normalization.
 * @returns Native SvelteKit live query wrapper.
 */
export function make_remote_live_wrapper<Input, A>(
	handler: RemoteLiveHandler<Input, A, unknown, unknown>,
	helper_name: string,
): (input: unknown) => Promise<unknown> {
	return async (input: unknown) => {
		let event: RequestEvent;

		try {
			event = get_native_request_event() as unknown as RequestEvent;
		} catch (error: unknown) {
			throw normalize_remote_helper_error(error, helper_name);
		}

		return await run_inside_remote_effect_handler(() => {
			try {
				const result = typeof handler === "function" ? handler(input as Input) : handler;

				return run_live_handler_source(result, event);
			} catch (error: unknown) {
				throw normalize_remote_helper_error(error, helper_name);
			}
		});
	};
}

/**
 * Builds the wrapper passed to native form helpers.
 *
 * @since 2.0.0
 * @param handler - Effect-aware form handler.
 * @param helper_name - Remote helper name for error normalization.
 * @returns Native SvelteKit form handler wrapper.
 */
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

		return await run_inside_remote_effect_handler(() => {
			const invalid_proxy = make_invalid_proxy<Input>();

			try {
				const result = handler({
					data: data as Input,
					invalid: invalid_proxy,
					issue,
				});

				return run_handler_effect(result, event);
			} catch (error: unknown) {
				throw normalize_remote_helper_error(error, helper_name);
			}
		});
	};
}

async function run_inside_remote_effect_handler<A>(run: () => Promise<A>): Promise<A> {
	running_remote_effect_handlers += 1;

	try {
		return await run();
	} finally {
		running_remote_effect_handlers -= 1;
	}
}
