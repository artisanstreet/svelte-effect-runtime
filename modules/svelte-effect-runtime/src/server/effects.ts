import { run_remote_effect } from "$/remote/server.ts";
import { error as svelte_error, invalid } from "@sveltejs/kit";
import { Effect, Stream } from "effect";

import { get_server_runtime_or_throw, RequestEvent } from "./runtime.ts";
import type { RequestEvent as RequestEventShape } from "./runtime.ts";
import type { EffectLike, EffectRemoteLiveSource } from "./types.ts";

type ResolvedLiveSource<A> =
  | AsyncIterable<A>
  | AsyncIterator<A>
  | Iterable<A>
  | Iterator<A>;

type LiveHandlerResult<A> =
  | EffectLike<EffectRemoteLiveSource<A>>
  | EffectRemoteLiveSource<A>;

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
 * Checks whether a value is a live query source SvelteKit can consume.
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value is an Effect Stream or native iterable source.
 */
export function is_live_source<A>(
  value: unknown,
): value is EffectRemoteLiveSource<A> {
  if (Stream.isStream(value)) {
    return true;
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  const source = value as {
    readonly next?: unknown;
    readonly [Symbol.asyncIterator]?: unknown;
    readonly [Symbol.iterator]?: unknown;
  };

  return (
    typeof source.next === "function" ||
    typeof source[Symbol.asyncIterator] === "function" ||
    typeof source[Symbol.iterator] === "function"
  );
}

/**
 * Runs and normalizes a live query handler result with request services
 * available to Effect Streams.
 *
 * @since 2.0.0
 * @param value - Live query source or Effect that resolves to one.
 * @param event - SvelteKit request event for this remote call.
 * @returns Promise resolving with a source SvelteKit can stream.
 */
export function run_live_handler_source<A>(
  value: LiveHandlerResult<A>,
  event: RequestEventShape,
): Promise<ResolvedLiveSource<A>> {
  const runtime = get_server_runtime_or_throw();
  const effect = Effect.provideService(
    to_live_source_effect(value),
    RequestEvent,
    event,
  ) as Effect.Effect<ResolvedLiveSource<A>, unknown, unknown>;

  return run_remote_effect(
    effect,
    runtime,
    svelte_invalid,
    svelte_remote_error,
  );
}

function to_live_source_effect<A>(
  value: LiveHandlerResult<A>,
): Effect.Effect<ResolvedLiveSource<A>, unknown, unknown> {
  if (Stream.isStream(value)) {
    return Stream.toAsyncIterableEffect(
      value as Stream.Stream<A, unknown, unknown>,
    ) as Effect.Effect<ResolvedLiveSource<A>, unknown, unknown>;
  }

  if (is_native_live_source<A>(value)) {
    return Effect.succeed(value);
  }

  if (!Effect.isEffect(value)) {
    return Effect.fail(
      new Error(
        "[INVALID_LIVE_QUERY_SOURCE]: Query.live handler must return an Effect Stream, Iterable, or AsyncIterable",
      ),
    );
  }

  return Effect.flatMap(
    value as Effect.Effect<EffectRemoteLiveSource<A>, unknown, unknown>,
    to_live_source_effect,
  );
}

function is_native_live_source<A>(
  value: unknown,
): value is ResolvedLiveSource<A> {
  return is_live_source<A>(value) && !Stream.isStream(value);
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
