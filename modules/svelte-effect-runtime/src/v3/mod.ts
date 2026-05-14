/**
 * v3 public entrypoint for `svelte-effect-runtime`.
 *
 * Exposes the stable client runtime, lifecycle helpers, and shared remote
 * error / result types. Import from `svelte-effect-runtime/v3` to pin against
 * the v3 runtime explicitly; the package default entry (`mod.ts`) re-exports
 * everything here.
 *
 * @example
 * ```ts
 * import {
 *   ClientRuntime,
 *   run_component_effect,
 * } from "svelte-effect-runtime/v3";
 * import { Effect } from "effect";
 *
 * const runtime = ClientRuntime.make();
 * run_component_effect(runtime, Effect.log("hi from v3"));
 * ```
 *
 * @see https://ser.barekey.dev/
 *
 * @module
 */
export type { EffectPreprocessOptions } from "$/v3/preprocess.ts";
export type {
  ClientRuntimeService,
  EffectRuntime,
  FormError,
  FormIssue,
  RemoteDomainError,
  RemoteFailure,
  RemoteHttpError,
  RemoteTransportError,
  RemoteValidationError,
} from "$/v3/client.ts";

export {
  ClientRuntime,
  get_effect_runtime_or_throw,
  run_component_effect,
  run_inline_effect,
  to_effect,
  to_native,
} from "$/v3/client.ts";
