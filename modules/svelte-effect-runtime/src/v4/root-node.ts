import type * as Server_module from "$/v4/server.ts";

export * from "$/v4/mod.ts";
export type * from "$/v4/server.ts";
export type { EffectPluginOptions } from "$/v4/effect.ts";
export { effect } from "$/v4/effect.ts";

/**
 * Define a read-only remote function that returns an `Effect` on the client.
 *
 * @see https://ser.barekey.dev/content/remote-functions/query
 */
export declare const Query: typeof Server_module.Query;
/**
 * Define a write-oriented remote function that returns an `Effect` on the
 * client.
 *
 * @see https://ser.barekey.dev/content/remote-functions/command
 */
export declare const Command: typeof Server_module.Command;
/**
 * Define a remote form handler that maps submitted data into an Effect
 * program.
 *
 * @see https://ser.barekey.dev/content/remote-functions/form
 */
export declare const Form: typeof Server_module.Form;
/**
 * Define a prerenderable remote function backed by an Effect program.
 *
 * @see https://ser.barekey.dev/content/remote-functions/prerender
 */
export declare const Prerender: typeof Server_module.Prerender;
/**
 * Effect `Context.Tag` for the current SvelteKit `RequestEvent`.
 *
 * @see https://ser.barekey.dev/content/runtimes/server
 */
export declare const RequestEvent: typeof Server_module.RequestEvent;
/**
 * Server-side runtime builder used to provide long-lived Effect services to
 * remote functions.
 *
 * @see https://ser.barekey.dev/content/reference/server-runtime
 */
export declare const ServerRuntime: typeof Server_module.ServerRuntime;
/**
 * Build a devalue transport table from Effect schemas so remote payloads can
 * round-trip custom data across the client/server boundary.
 *
 * @see https://ser.barekey.dev/content/reference/transport
 */
export declare const create_effect_transport:
  typeof Server_module.create_effect_transport;
/**
 * Resolve the active server runtime, lazily creating a default empty runtime
 * when no explicit one has been registered.
 *
 * @internal Internal - do not use.
 * @see https://ser.barekey.dev/content/reference/server-runtime
 */
export declare const get_server_runtime_or_throw:
  typeof Server_module.get_server_runtime_or_throw;
