import { error as svelte_error, invalid as svelte_invalid } from "@sveltejs/kit";
import { create_serialized_remote_failure_envelope } from "$/remote/shared.ts";
import { encode_remote_failure, run_remote_effect } from "$/remote/server.ts";
import { get_server_runtime_or_throw, RequestEvent } from "./runtime.ts";
import type { RequestEvent as RequestEventShape } from "./runtime.ts";
import { InvalidLiveQueryReturnError } from "$/errors.ts";
import { Cause, Effect, Stream } from "effect";
import type { EffectLike } from "./types.ts";

type ResolvedLiveSource<A> = AsyncIterable<A>;

type LiveHandlerResult<A> = Stream.Stream<A, unknown, unknown>;

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
export function ToEffect<A, E, R>(value: EffectLike<A, E, R>): Effect.Effect<A, E, R> {
	if (is_generator_result<A>(value)) {
		return Effect.gen(() => value) as Effect.Effect<A, E, R>;
	}

	return value;
}

/**
 * Checks whether a value is an Effect Stream live source.
 *
 * @since 2.0.0
 * @param value - Value to inspect.
 * @returns Whether the value is an Effect Stream.
 */
export function is_live_source<A>(value: unknown): value is Stream.Stream<A, unknown, unknown> {
	return Stream.isStream(value);
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
	if (!is_live_source(value)) {
		throw new InvalidLiveQueryReturnError();
	}

	const runtime = get_server_runtime_or_throw();
	const EffectWithRequestEvent = Effect.provideService(
		ToLiveSourceEffect(value),
		RequestEvent,
		event,
	) as Effect.Effect<ResolvedLiveSource<A>, unknown, unknown>;

	return run_remote_effect(EffectWithRequestEvent, runtime, svelte_invalid, svelte_remote_error);
}

function ToLiveSourceEffect<A>(
	value: LiveHandlerResult<A>,
): Effect.Effect<ResolvedLiveSource<A>, unknown, unknown> {
	return Stream.toAsyncIterableEffect(value as Stream.Stream<A, unknown, unknown>).pipe(
		Effect.map(wrap_live_source_errors),
	) as Effect.Effect<ResolvedLiveSource<A>, unknown, unknown>;
}

function wrap_live_source_errors<A>(source: AsyncIterable<A>): AsyncIterable<A> {
	return {
		[Symbol.asyncIterator]() {
			const iterator = source[Symbol.asyncIterator]();

			return {
				async next() {
					try {
						return await iterator.next();
					} catch (error: unknown) {
						throw_live_source_error(error);
					}
				},

				async return(value?: unknown) {
					if (iterator.return) {
						return await iterator.return(value);
					}

					return {
						done: true,
						value: undefined as A,
					};
				},

				async throw(error?: unknown) {
					if (iterator.throw) {
						return await iterator.throw(error);
					}

					throw_live_source_error(error);
				},
			};
		},
	};
}

function throw_live_source_error(error: unknown): never {
	const encoded = encode_remote_failure(Cause.fail(error));
	const envelope = create_serialized_remote_failure_envelope(encoded);

	svelte_error(500, envelope as never);
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
	value: EffectLike<A, unknown, unknown>,
	event: RequestEventShape,
): Promise<A> {
	const runtime = get_server_runtime_or_throw();
	const EffectWithRequestEvent = Effect.provideService(
		ToEffect(value),
		RequestEvent,
		event,
	) as Effect.Effect<A, unknown, unknown>;

	return run_remote_effect(EffectWithRequestEvent, runtime, svelte_invalid, svelte_remote_error);
}

const svelte_remote_error = (status: number, body: unknown): never => {
	svelte_error(status as never, body as never);
};
