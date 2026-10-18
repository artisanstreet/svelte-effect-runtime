import { requested } from "$app/server";
import { Effect } from "effect";

/** The published stable package predates `Requested`, so it answers client refreshes natively. */
export const RefreshRequested = (query: unknown, limit: number) =>
	Effect.promise(() => requested(query as never, limit).refreshAll());
