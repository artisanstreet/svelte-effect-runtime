import { Dispatcher as InternalDispatcher } from "$/dispatcher.ts";
import type { Layer } from "effect";

/**
 * Result returned by the root Svelte markup preprocessor hook.
 *
 * @since 2.0.0
 */
interface MarkupResult {
  code: string;
}

/**
 * Root preprocessor group shape. The root export keeps transform code lazy so
 * client imports do not pull parser-only dependencies into the browser.
 *
 * @since 2.0.0
 */
interface PreprocessGroup {
  name: string;
  markup(
    options: { content: string; filename: string },
  ): MarkupResult | Promise<MarkupResult>;
}

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

/**
 * Creates the Svelte preprocessor that lowers script and markup `yield*`
 * expressions. The heavy transform module is loaded lazily so browser imports
 * from the package root stay client-safe.
 *
 * @example
 * ```js
 * import { preprocess } from "svelte-effect-runtime";
 *
 * export default {
 *   preprocess: [preprocess()],
 * };
 * ```
 *
 * @since 2.0.0
 * @returns A Svelte preprocessor group with an async markup hook.
 */
export function preprocess(): PreprocessGroup {
  return {
    name: "svelte-effect-runtime",

    async markup(options: { content: string; filename: string }) {
      const runtime = await import("./runtime/preprocess.ts");
      const group = runtime.preprocess();

      return await group.markup(options);
    },
  };
}
