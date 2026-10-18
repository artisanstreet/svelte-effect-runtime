import { read_provided_services, set_provided_services } from "$/dispatcher/services.ts";
import { get_dispatcher } from "$/generated/dispatcher.ts";
import { Context, Effect, Layer } from "effect";
import { onDestroy } from "svelte";

/**
 * Builds a layer for the calling component's subtree. Every SER Effect in a
 * descendant component can use the layer's services on top of the runtime's
 * own; nested providers add to, and may depend on, the services above them.
 * The layer is built once per component instance and released when it is
 * destroyed. Call it during component initialisation.
 *
 * @example
 * ```svelte
 * <script lang="ts" effect>
 *   import { ProvideLayer } from "svelte-effect-runtime";
 *   import { Workspace } from "$lib/workspace";
 *
 *   let { workspace_id } = $props();
 *
 *   ProvideLayer(Workspace.layer(workspace_id));
 * </script>
 * ```
 *
 * @since 5.0.0
 * @param layer - The layer whose services descendant components receive. Its
 *   own requirements are satisfied by the runtime layer and any ancestor
 *   `ProvideLayer`.
 */
export function ProvideLayer<ROut, E, RIn>(layer: Layer.Layer<ROut, E, RIn>): void {
	const inherited = read_provided_services();
	const dispatcher = get_dispatcher();
	const scope = dispatcher.begin_scope();

	const Build = Effect.gen(function* () {
		const parent = inherited
			? yield* Effect.promise(() => inherited)
			: (Context.empty() as Context.Context<never>);
		const built = yield* Effect.provideContext(
			Layer.buildWithScope(layer, scope.underlying),
			parent,
		);

		return Context.merge(parent, built) as Context.Context<never>;
	});

	const services = dispatcher.run(Build as Effect.Effect<Context.Context<never>, E>);

	/** Failures are reported by the dispatcher and again by each descendant Effect. */
	services.catch(() => {});

	set_provided_services(services);
	onDestroy(() => dispatcher.dispose_scope(scope));
}
