import { get_dispatcher as get_client_dispatcher } from "$/dispatcher.ts";
import { get_server_dispatcher } from "$/server/runtime.ts";
import type { Dispatcher } from "$/dispatcher.ts";

/**
 * Returns the dispatcher appropriate for generated component code.
 *
 * @example
 * ```ts
 * const dispatcher = get_dispatcher();
 * ```
 *
 * @since 3.0.1
 * @returns The server dispatcher during SSR, otherwise the client dispatcher.
 */
export function get_dispatcher(): Dispatcher {
  if (typeof document === "undefined") {
    return get_server_dispatcher();
  }

  return get_client_dispatcher();
}
