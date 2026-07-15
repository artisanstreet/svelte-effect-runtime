import { get_native_remote_live_resource } from "$/live.ts";

const native_remote_query_update: unique symbol = Symbol.for(
	"svelte-effect-runtime/native-remote-query-update",
) as never;

type NativeRemoteQueryUpdateCarrier = {
	readonly [native_remote_query_update]?: unknown;
};

export function attach_native_remote_query_update(target: unknown, native_update: unknown): void {
	if (!is_reference(target)) {
		return;
	}

	Object.defineProperty(target, native_remote_query_update, {
		configurable: true,
		value: native_update,
	});
}

export function resolve_native_remote_query_updates(updates: readonly unknown[]): unknown[] {
	return updates.map(resolve_native_remote_query_update);
}

function resolve_native_remote_query_update(update: unknown): unknown {
	if (!is_reference(update)) {
		return update;
	}

	const carrier = update as NativeRemoteQueryUpdateCarrier;
	const attached_update = carrier[native_remote_query_update];
	const live_resource = get_native_remote_live_resource(update);

	return attached_update ?? live_resource ?? update;
}

function is_reference(value: unknown): value is object | ((...args: never[]) => unknown) {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}
