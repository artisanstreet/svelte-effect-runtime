import { RunInsideRemoteEffectHandler } from "./remote-handler-context.ts";
import { get_server_runtime_or_throw, RequestEvent } from "./runtime.ts";
import type { RequestEvent as RequestEventShape } from "./runtime.ts";
import type { EffectHandler } from "./types.ts";
import { ToEffect } from "./effects.ts";
import { Effect } from "effect";

type NativeErrorHook = (input: never) => unknown;

/**
 * Adapts an Effect-producing callback to SvelteKit's server `handleError`
 * hook. The callback runs through the configured {@link ServerRuntime}, so it
 * can use logging or telemetry services from the server layer.
 *
 * @example
 * ```ts
 * import type { HandleServerError } from "@sveltejs/kit/hooks";
 * import { HandleError } from "svelte-effect-runtime";
 *
 * export const handleError = HandleError<HandleServerError>(function* ({ error, event }) {
 *   yield* Effect.logError("request failed", event.url.pathname, error);
 *
 *   return { message: "Something went wrong" };
 * });
 * ```
 *
 * @since 5.0.0
 * @param hook - Effect-producing callback receiving SvelteKit's `handleError`
 *   input. Its successful value is the `App.Error` body SvelteKit sends, and
 *   it must recover every failure.
 * @returns A native `handleError` hook. Unlike {@link Handler}, it is not
 *   interrupted when the request aborts, so the error body is always produced.
 */
export function HandleError<NativeHook extends NativeErrorHook>(
	hook: EffectHandler<NativeHook>,
): NativeHook {
	const native_hook = (...arguments_: Parameters<NativeHook>) => {
		const [input] = arguments_ as unknown as [{ readonly event: RequestEventShape }];
		const runtime = get_server_runtime_or_throw();
		const HookEffect = Effect.suspend(() => ToEffect(hook(...arguments_)));
		const HookOwnedEffect = RunInsideRemoteEffectHandler(input.event, HookEffect);
		const EffectWithRequestEvent = Effect.provideService(
			HookOwnedEffect,
			RequestEvent,
			input.event,
		);

		return runtime.runPromise(EffectWithRequestEvent);
	};

	return native_hook as unknown as NativeHook;
}
