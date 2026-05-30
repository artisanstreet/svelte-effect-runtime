import { getRequestEvent as get_native_request_event } from "$app/server";
import { normalize_remote_helper_error } from "$/remote/server.ts";

import { run_handler_effect } from "./effects.ts";
import { make_invalid_proxy } from "./invalid.ts";
import { is_handler } from "./schema.ts";
import type { RequestEvent } from "./runtime.ts";
import type { EffectLike, RemoteFormHandler, RemoteHandler } from "./types.ts";

/**
 * Builds the wrapper passed to native query, command, and prerender helpers.
 *
 * @since 2.0.0
 * @param handler - Effect handler or already-built Effect-like value.
 * @param helper_name - Remote helper name for error normalization.
 * @returns Native SvelteKit handler wrapper.
 */
export function make_remote_wrapper(
  handler: RemoteHandler | EffectLike,
  helper_name: string,
): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    try {
      const event = get_native_request_event() as unknown as RequestEvent;
      const result = is_handler(handler) ? handler(input) : handler;

      return await run_handler_effect(result, event);
    } catch (error: unknown) {
      throw normalize_remote_helper_error(error, helper_name);
    }
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
export function make_remote_form_wrapper(
  handler: RemoteFormHandler,
  helper_name: string,
): (data: unknown, issue: unknown) => Promise<unknown> {
  return async (data: unknown, issue: unknown) => {
    try {
      const event = get_native_request_event() as unknown as RequestEvent;
      const invalid_proxy = make_invalid_proxy();
      const result = handler({ data, invalid: invalid_proxy, issue });

      return await run_handler_effect(result, event);
    } catch (error: unknown) {
      throw normalize_remote_helper_error(error, helper_name);
    }
  };
}
