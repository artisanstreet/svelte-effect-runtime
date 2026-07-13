import type { Effect } from "effect";

export const Code = {
	Markup: {
		Promise: "MarkupPromise",
		Run: "MarkupRun",
		Value: "MarkupValue",
	},
} as const;

export interface MarkupPromiseOptions {
	/** Keep the SSR promise pending so Svelte renders an await block fallback. */
	ssr?: "pending";
}

export type Dispose = () => void;

export interface ValueOptions<A> {
	/** Stable cache key for this value block. */
	id: string;
	deps: readonly unknown[];
	/** Value returned synchronously while the effect is running or during SSR. */
	fallback: A;
	factory: () => Effect.gen.Return<A, unknown, unknown>;
}

export interface PromiseOptions<A> {
	/** Stable cache key for this promise block. */
	id: string;
	deps: readonly unknown[];
	factory: () => Effect.gen.Return<A, unknown, unknown>;
}

export interface MarkupValueEvent<A, F> {
	type: typeof Code.Markup.Value;
	/** Stable identifier generated from the expression's source position. */
	id: string;
	deps: readonly unknown[];
	/** Value returned synchronously while the effect is pending. */
	fallback: F;
	fn: () => Effect.gen.Return<A, unknown, unknown>;
}

export interface MarkupPromiseEvent<A> {
	type: typeof Code.Markup.Promise;
	/** Stable identifier generated from the expression's source position. */
	id: string;
	deps: readonly unknown[];
	fn: () => Effect.gen.Return<A, unknown, unknown>;
	/** Value resolved during SSR when a fallback is required. */
	ssr_fallback?: A;
	/** Optional SSR behavior for await blocks and similar contexts. */
	options?: MarkupPromiseOptions;
}

export interface MarkupRunEvent<A> {
	type: typeof Code.Markup.Run;
	fn: () => Effect.gen.Return<A, unknown, unknown>;
}

export type DispatcherEvent<A, F = A> =
	| MarkupPromiseEvent<A>
	| MarkupRunEvent<A>
	| MarkupValueEvent<A, F>;
