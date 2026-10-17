import type { NativeRemoteQueryOverride } from "$/remote/native-types.ts";
import type { EffectRemoteQueryUpdateBrand } from "$/remote/client/types.ts";
import { attach_lazy_native_remote_query_update } from "./query-update.ts";
import type { RemoteFailure } from "$/remote/shared.ts";
import { MakeEffectFromSync } from "./effect.ts";
import type { Effect } from "effect";

/**
 * Optimistic query override. Yield it to apply the override and receive its
 * release function, or pass it un-yielded to `.updates(...)` so it applies
 * when the command runs and is released when the command settles.
 *
 * @since 5.0.0
 */
export type EffectRemoteQueryOverride = EffectRemoteQueryUpdateBrand &
	Effect.Effect<NativeRemoteQueryOverride, RemoteFailure<never>>;

type NativeSet<Output> = (value: Output) => void;

type NativeWithOverride<Output> = (update: (current: Output) => Output) => unknown;

export const MakeQuerySet = <Output>(resource: unknown, set: NativeSet<Output>, value: Output) =>
	MakeEffectFromSync<void>(() => set.call(resource, value));

export function make_query_override<Output>(
	resource: unknown,
	with_override: NativeWithOverride<Output>,
	update: (current: Output) => Output,
): EffectRemoteQueryOverride {
	const apply = () => with_override.call(resource, update) as NativeRemoteQueryOverride;
	const OverrideEffect = MakeEffectFromSync<NativeRemoteQueryOverride>(apply);

	attach_lazy_native_remote_query_update(OverrideEffect, apply);

	return OverrideEffect as unknown as EffectRemoteQueryOverride;
}
