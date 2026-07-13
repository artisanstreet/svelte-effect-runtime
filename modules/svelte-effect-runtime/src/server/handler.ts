import { getRequestEvent as get_native_request_event } from "$app/server";
import { get_server_runtime_or_throw, RequestEvent } from "./runtime.ts";
import type { EffectHandler } from "./types.ts";
import { ToEffect } from "./effects.ts";
import { Effect } from "effect";

/**
 * Adapts an Effect-producing callback to a native SvelteKit server handler.
 * SvelteKit continues to select the handler by its exported binding name, such
 * as `GET`, `PUT`, or `load`.
 *
 * @example A `+server.ts` request handler:
 * ```ts
 * import { Handler } from "svelte-effect-runtime/server";
 * import type { RequestHandler } from "./$types";
 *
 * export const GET = Handler<RequestHandler>(function* ({ params }) {
 *   const post = yield* Posts.get(params.slug);
 *
 *   return Response.json(post);
 * });
 * ```
 *
 * @example A `+page.server.ts` load function:
 * ```ts
 * import { Handler } from "svelte-effect-runtime/server";
 * import type { PageServerLoad } from "./$types";
 *
 * export const load = Handler<PageServerLoad>(function* ({ locals }) {
 *   const profile = yield* Profiles.get(locals.user.id);
 *
 *   return { profile };
 * });
 * ```
 *
 * @since 4.0.0
 * @param handler - Effect-producing callback whose parameters and successful
 *   result match the native SvelteKit handler type.
 * @returns A native handler that runs the callback through the configured
 *   {@link ServerRuntime} with the current {@link RequestEvent} available.
 */
export function Handler<NativeHandler extends (...arguments_: never[]) => unknown>(
	handler: EffectHandler<NativeHandler>,
): NativeHandler {
	const native_handler = async (...arguments_: Parameters<NativeHandler>) => {
		const event = get_native_request_event();
		const runtime = get_server_runtime_or_throw();
		const HandlerEffect = Effect.suspend(() => ToEffect(handler(...arguments_)));
		const EffectWithRequestEvent = Effect.provideService(HandlerEffect, RequestEvent, event);

		return await runtime.runPromise(EffectWithRequestEvent);
	};

	return native_handler as unknown as NativeHandler;
}
