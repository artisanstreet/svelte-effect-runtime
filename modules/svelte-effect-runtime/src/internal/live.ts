import { Context } from "effect";

/** Brands remote live streams without relying on class identity. */
export const remote_live_stream: unique symbol = Symbol.for("ser.remote-live-stream") as never;

/** Selects the cached-first live source while generated yields resolve. */
export const RemoteLiveYield = Context.Reference<boolean>("ser.remote-live-yield", {
	defaultValue: () => false,
});

/** Internal carrier that identifies a remote live Stream. */
export type RemoteLiveStreamCarrier = {
	readonly [remote_live_stream]?: true;
};
