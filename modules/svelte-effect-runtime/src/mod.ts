import { Layer, ManagedRuntime } from "effect";
import { Dispatcher as InternalDispatcher } from "$/dispatcher.ts";

/**
 * Public API surface for `svelte-effect-runtime`.
 *
 * Users configure the client runtime with {@link configure_runtime} and
 * import error types for typed catch handlers. Everything else is handled
 * by the Vite plugin and generated code automatically.
 *
 * @module
 */

/**
 * Configure the client-side effect runtime with an optional layer. Must
 * be called before any component renders — typically in a SvelteKit
 * `hooks.client.ts` or `+layout.svelte` `<script>` block.
 *
 * If never called, a default empty-layer runtime is created lazily on
 * the first `yield*` expression.
 *
 * @example
 * ```ts
 * import { configure_runtime } from "svelte-effect-runtime";
 * import { Db } from "./db.ts";
 *
 * configure_runtime(Db.Live);
 * ```
 *
 * @since 2.0.0
 * @param layer - Optional Effect layer to provide to the runtime.
 */
export function configure_runtime<R = never>(
  layer?: Layer.Layer<R>,
): void {
  InternalDispatcher.make(layer);
}

/** Re-export error types users need for typed catch handlers. */
export type {
  FormError,
  FormIssue,
  RemoteFailure,
  RemoteHttpError,
  RemoteTransportError,
  RemoteValidationError,
} from "$/remote/shared.ts";

export {
  is_form_error,
  is_remote_http_error,
  is_remote_transport_error,
  is_remote_validation_error,
} from "$/remote/shared.ts";

/** Re-export Vite plugin so users can import everything from root. */
export { effect, type EffectOptions } from "$/vite.ts";
