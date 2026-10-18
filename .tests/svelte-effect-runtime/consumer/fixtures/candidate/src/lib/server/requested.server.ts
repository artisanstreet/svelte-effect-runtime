import type { EffectRemoteQueryFunction } from "svelte-effect-runtime";
import { Requested } from "svelte-effect-runtime";

export const RefreshRequested = <A, E>(
	query: EffectRemoteQueryFunction<void, A, E, void>,
	limit: number,
) => Requested.refreshAll(query, limit);
