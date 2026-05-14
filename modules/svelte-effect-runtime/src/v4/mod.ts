/**
 * v4 public entrypoint for `svelte-effect-runtime`.
 *
 * Targets Effect v4 (beta) while sharing the underlying client helpers with
 * v3. Importing from `svelte-effect-runtime/v4` opts into the v4 preprocess /
 * Vite pipeline and the v4-flavoured server helpers exposed through the
 * `/v4/_server` subpath.
 *
 * @example
 * ```ts
 * import {
 *   ClientRuntime,
 *   run_component_effect,
 * } from "svelte-effect-runtime/v4";
 * import { Effect } from "effect";
 *
 * const runtime = ClientRuntime.make();
 * run_component_effect(runtime, Effect.log("hi from v4"));
 * ```
 *
 * @see https://ser.barekey.dev/
 *
 * @module
 */
export type { EffectPreprocessOptions } from "$/v4/preprocess.ts";
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
} from "$/v4/client.ts";

export {
  ClientRuntime,
  get_effect_runtime_or_throw,
  run_component_effect,
  run_inline_effect,
  to_effect,
  to_native,
} from "$/v4/client.ts";
