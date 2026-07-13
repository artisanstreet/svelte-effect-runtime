import { getRequestEvent as get_native_request_event } from "$app/server";
import { Effect } from "effect";

const active_remote_handler_counts = new WeakMap<object, number>();

/**
 * Reports whether SER is executing a remote handler for one request event.
 *
 * @example
 * ```ts
 * if (is_running_remote_effect_handler(event)) {
 *   return nested_query();
 * }
 * ```
 *
 * @since 2.0.0
 * @param event - Request event whose active remote-handler ownership should be
 *   inspected. When omitted, the active SvelteKit request event is used.
 * @returns Whether at least one remote handler is active for this exact
 *   request event.
 * @internal
 */
export function is_running_remote_effect_handler(event?: object): boolean {
	const request_event = event ?? get_current_request_event();

	if (!request_event) {
		return false;
	}

	return (active_remote_handler_counts.get(request_event) ?? 0) > 0;
}

/**
 * Runs an Effect while marking its request event as owned by an SER remote
 * handler.
 *
 * @example
 * ```ts
 * const result = yield* RunInsideRemoteEffectHandler(event, program);
 * ```
 *
 * @since 4.0.1
 * @param event - Request event used to isolate ownership from concurrent
 *   requests.
 * @param effect - Remote handler Effect to run while the event is marked as
 *   active.
 * @returns An Effect that releases the request-local ownership marker on every
 *   exit path.
 * @internal
 */
export function RunInsideRemoteEffectHandler<A, E, R>(
	event: object,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
	return Effect.acquireUseRelease(
		AcquireRemoteHandlerOwnership(event),
		() => effect,
		() => ReleaseRemoteHandlerOwnership(event),
	);
}

function AcquireRemoteHandlerOwnership(event: object): Effect.Effect<void> {
	return Effect.sync(() => {
		const active_count = active_remote_handler_counts.get(event) ?? 0;

		active_remote_handler_counts.set(event, active_count + 1);
	});
}

function ReleaseRemoteHandlerOwnership(event: object): Effect.Effect<void> {
	return Effect.sync(() => {
		const remaining_count = (active_remote_handler_counts.get(event) ?? 1) - 1;

		if (remaining_count === 0) {
			active_remote_handler_counts.delete(event);

			return;
		}

		active_remote_handler_counts.set(event, remaining_count);
	});
}

function get_current_request_event(): object | undefined {
	try {
		const event = get_native_request_event();

		return typeof event === "object" && event !== null ? event : undefined;
	} catch {
		return undefined;
	}
}
