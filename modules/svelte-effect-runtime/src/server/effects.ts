import { run_remote_effect } from "$/remote/server.ts";
import { Effect } from "effect";
import { error as svelte_error, invalid } from "@sveltejs/kit";

import { get_server_runtime_or_throw, RequestEvent } from "./runtime.ts";
import type { EffectLike } from "./types.ts";
import type { RequestEvent as RequestEventShape } from "./runtime.ts";

/**
 * Checks whether a value is an Effect generator return object.
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value should be wrapped with `Effect.gen`.
 */
export function is_generator_result<A>(
  value: unknown,
): value is Effect.gen.Return<A, unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { next?: unknown }).next === "function"
  );
}

/**
 * Normalizes an Effect-like handler return value into an Effect.
 *
 * @since 2.0.0
 * @param value - Effect or generator return value.
 * @returns Normalized Effect.
 */
export function to_effect<A>(
  value: EffectLike<A>,
): Effect.Effect<A, unknown, unknown> {
  if (is_generator_result<A>(value)) {
    return Effect.gen(() => value);
  }

  return value;
}

/**
 * Runs a remote handler Effect with the current request event provided.
 *
 * @since 2.0.0
 * @param value - Handler return value.
 * @param event - SvelteKit request event for this remote call.
 * @returns Promise resolving with the handler output.
 */
export function run_handler_effect<A>(
  value: EffectLike<A>,
  event: RequestEventShape,
): Promise<A> {
  const runtime = get_server_runtime_or_throw();
  const effect = Effect.provideService(
    to_effect(value),
    RequestEvent,
    event,
  ) as Effect.Effect<A, unknown, unknown>;

  return run_remote_effect(
    effect,
    runtime,
    svelte_invalid,
    svelte_remote_error,
  );
}

const svelte_invalid = (_status: number, body: unknown): never => {
  const issues = typeof body === "object" && body !== null &&
      Array.isArray((body as { issues?: unknown }).issues)
    ? (body as { issues: unknown[] }).issues
    : [String(body)];

  invalid(...(issues as never[]));
};

const svelte_remote_error = (status: number, body: unknown): never => {
  svelte_error(status as never, body as never);
};
