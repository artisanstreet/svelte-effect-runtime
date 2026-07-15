import { make_remote_live_snapshot_encoder, type NativeTransport } from "./live-snapshot.ts";

import * as SvelteKitInternalServer from "@sveltejs/kit/internal/server";

type NativeRequestStore = {
	readonly state: {
		readonly transport: NativeTransport;
	};
};

type NativeServerInternals = {
	readonly try_get_request_store?: () => NativeRequestStore | null;
};

/** Creates the current SvelteKit request's transport-aware live snapshot encoder. */
export function get_remote_live_snapshot_encoder(): ((value: unknown) => string) | undefined {
	const try_get_request_store = (SvelteKitInternalServer as unknown as NativeServerInternals)
		.try_get_request_store;
	const request_store = try_get_request_store?.();

	if (!request_store) {
		return undefined;
	}

	return make_remote_live_snapshot_encoder(request_store.state.transport);
}
