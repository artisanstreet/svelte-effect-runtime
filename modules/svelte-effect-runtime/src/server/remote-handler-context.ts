import { getRequestEvent as get_native_request_event } from "$app/server";
import { Effect } from "effect";

const active_remote_handler_counts = new WeakMap<object, number>();

/** Tracks ownership per request event so concurrent requests remain isolated. */
export function is_running_remote_effect_handler(event?: object): boolean {
	const request_event = event ?? get_current_request_event();

	if (!request_event) {
		return false;
	}

	return (active_remote_handler_counts.get(request_event) ?? 0) > 0;
}

/** Marks one request as handler-owned for the lifetime of the supplied Effect. */
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
