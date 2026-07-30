import { error as svelte_error, invalid as svelte_invalid } from "@sveltejs/kit";
import {
	run_remote_effect,
	throw_remote_cause,
	to_remote_failure_context,
} from "$/remote/server.ts";
import { RunInsideRemoteEffectHandler } from "./remote-handler-context.ts";
import { get_server_runtime_or_throw, RequestEvent } from "./runtime.ts";
import type { RequestEvent as RequestEventShape } from "./runtime.ts";
import { InvalidLiveQueryReturnError } from "$/errors.ts";
import { Effect, Stream } from "effect";
import type { EffectLike } from "./types.ts";

type ResolvedLiveSource<A> = AsyncIterable<A>;

type LiveHandlerResult<A> = Stream.Stream<A, unknown, unknown>;

type LiveHandler<A> = () => LiveHandlerResult<A>;

export function is_generator_result<A>(
	value: unknown,
): value is Effect.gen.Return<A, unknown, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { next?: unknown }).next === "function"
	);
}

export function ToEffect<A, E, R>(value: EffectLike<A, E, R>): Effect.Effect<A, E, R> {
	if (is_generator_result<A>(value)) {
		return Effect.gen(() => value) as Effect.Effect<A, E, R>;
	}

	return value;
}

export function is_live_source<A>(value: unknown): value is Stream.Stream<A, unknown, unknown> {
	return Stream.isStream(value);
}

export function run_live_handler_source<A>(
	value: LiveHandlerResult<A>,
	event: RequestEventShape,
): Promise<ResolvedLiveSource<A>> {
	if (!is_live_source(value)) {
		throw new InvalidLiveQueryReturnError();
	}

	return run_live_source_effect(ToLiveSourceEffect(value, event), event);
}

/** Runs a live handler inside the request-local ownership scope. */
export function run_live_handler<A>(
	handler: LiveHandler<A>,
	event: RequestEventShape,
): Promise<ResolvedLiveSource<A>> {
	const LiveSourceEffect = Effect.suspend(() => {
		const value = handler();

		if (!is_live_source(value)) {
			return Effect.die(new InvalidLiveQueryReturnError());
		}

		return ToLiveSourceEffect(value, event);
	});

	return run_live_source_effect(RunInsideRemoteEffectHandler(event, LiveSourceEffect), event);
}

function run_live_source_effect<A>(
	effect: Effect.Effect<ResolvedLiveSource<A>, unknown, unknown>,
	event: RequestEventShape,
): Promise<ResolvedLiveSource<A>> {
	const runtime = get_server_runtime_or_throw();
	const EffectWithRequestEvent = Effect.provideService(
		effect,
		RequestEvent,
		event,
	) as Effect.Effect<ResolvedLiveSource<A>, unknown, unknown>;

	return run_remote_effect(
		EffectWithRequestEvent,
		runtime,
		svelte_invalid,
		svelte_remote_error,
		to_remote_failure_context(event),
	);
}

const ToLiveSourceEffect = <A>(value: LiveHandlerResult<A>, event: RequestEventShape) =>
	Stream.toAsyncIterableEffect(preserve_live_source_cause(value, event)).pipe(
		Effect.map((source) => wrap_live_source_errors(source, event)),
	) as Effect.Effect<ResolvedLiveSource<A>, unknown, unknown>;

const preserve_live_source_cause = <A>(value: LiveHandlerResult<A>, event: RequestEventShape) =>
	value.pipe(
		Stream.catchCause((cause) =>
			Stream.fromEffect(
				Effect.sync(() =>
					throw_remote_cause(
						cause,
						svelte_invalid,
						svelte_remote_error,
						to_remote_failure_context(event),
					),
				),
			),
		),
	);

function wrap_live_source_errors<A>(
	source: AsyncIterable<A>,
	event: RequestEventShape,
): AsyncIterable<A> {
	return {
		[Symbol.asyncIterator]() {
			const iterator = source[Symbol.asyncIterator]();
			const throw_iterator = iterator.throw?.bind(iterator);

			return {
				next() {
					return RunLiveIteratorCall(event, () => iterator.next());
				},

				return(value?: unknown) {
					if (iterator.return) {
						return RunLiveIteratorCall(
							event,
							() => iterator.return?.(value) as PromiseLike<IteratorResult<A>>,
						);
					}

					return Promise.resolve({
						done: true,
						value: undefined as A,
					});
				},
				...(throw_iterator === undefined
					? {}
					: {
							throw(error?: unknown) {
								return RunLiveIteratorCall(event, () => throw_iterator(error));
							},
						}),
			};
		},
	};
}

function RunLiveIteratorCall<A>(event: RequestEventShape, run: () => PromiseLike<A>): Promise<A> {
	const runtime = get_server_runtime_or_throw();
	const IteratorEffect = Effect.tryPromise({
		try: run,
		catch: (error: unknown) => error,
	});

	return runtime.runPromise(
		RunInsideRemoteEffectHandler(event, IteratorEffect) as Effect.Effect<A, unknown, unknown>,
	);
}

export function run_handler_effect<A>(
	value: EffectLike<A, unknown, unknown>,
	event: RequestEventShape,
): Promise<A> {
	const runtime = get_server_runtime_or_throw();
	const EffectWithRequestEvent = Effect.provideService(
		RunInsideRemoteEffectHandler(event, ToEffect(value)),
		RequestEvent,
		event,
	) as Effect.Effect<A, unknown, unknown>;

	return run_remote_effect(
		EffectWithRequestEvent,
		runtime,
		svelte_invalid,
		svelte_remote_error,
		to_remote_failure_context(event),
	);
}

const svelte_remote_error = (status: number, body: unknown): never => {
	svelte_error(status as never, body as never);
};
