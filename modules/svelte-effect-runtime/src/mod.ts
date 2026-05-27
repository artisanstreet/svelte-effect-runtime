import { Dispatcher as InternalDispatcher } from "$/dispatcher.ts";
import type { Layer } from "effect";

/**
 * Public API surface for `svelte-effect-runtime`.
 *
 * Call {@link ClientRuntime.make} in `hooks.client.ts`, import server helpers
 * from `svelte-effect-runtime/server`, and let the Vite plugin handle the
 * rest automatically.
 *
 * @module
 */

/**
 * Client-side runtime singleton. Call `ClientRuntime.make(layer?)` once
 * in `hooks.client.ts` to provide services to every component's effect
 * blocks.
 *
 * If never called, a default empty-layer runtime is created lazily on
 * the first `yield*` expression.
 *
 * @example
 * ```ts
 * import { ClientRuntime } from "svelte-effect-runtime";
 * import { Db } from "./db.ts";
 *
 * ClientRuntime.make(Db.Live);
 * ```
 *
 * @since 2.0.0
 */
export class ClientRuntime {
  /**
   * Build and cache the client-side dispatcher runtime.
   *
   * @since 2.0.0
   * @param layer - Optional Effect layer to provide to the runtime.
   */
  static make<R = never>(layer?: Layer.Layer<R>): void {
    InternalDispatcher.make(layer);
  }
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

/** Re-export app setup helpers so users can import them from root. */
export { effect, type EffectOptions } from "$/vite.ts";
export { preprocess } from "$/runtime/preprocess.ts";
