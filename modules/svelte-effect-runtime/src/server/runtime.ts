import { RequestEventUnavailableError, RuntimeAlreadyInitializedError } from "$/errors.ts";
import type { ManagedRuntime as ManagedRuntimeType } from "effect/ManagedRuntime";
import type { RequestEvent as SvelteKitRequestEvent } from "@sveltejs/kit";
import { Dispatcher as InternalDispatcher } from "$/dispatcher.ts";
import { Context, Layer, ManagedRuntime } from "effect";

type ViteImportMeta = ImportMeta & {
	readonly env?: {
		readonly DEV?: boolean;
		readonly MODE?: string;
		readonly SSR?: boolean;
	};
};

/**
 * Subset of SvelteKit's `RequestEvent` that remote handlers typically access.
 *
 * @example
 * ```ts
 * const event: RequestEvent = yield* RequestEvent;
 * console.log(event.url.pathname);
 * ```
 *
 * @since 2.0.0
 */
export interface RequestEvent extends Pick<
	SvelteKitRequestEvent,
	"cookies" | "getClientAddress" | "locals" | "params" | "platform" | "request" | "route" | "url"
> {}

/**
 * SvelteKit's `RequestEvent` exposed as an Effect {@link Context.Tag}.
 *
 * @example
 * ```ts
 * const event = yield* RequestEvent;
 * ```
 *
 * @since 2.0.0
 */
export const RequestEvent: Context.Reference<RequestEvent> = Context.Reference<RequestEvent>(
	"@ser/RequestEvent",
	{
		defaultValue: () => {
			throw new RequestEventUnavailableError();
		},
	},
);

/**
 * Builder for the server-side Effect runtime.
 *
 * @example
 * ```ts
 * ServerRuntime.make(Db.Live);
 * ```
 *
 * @since 2.0.0
 */
export class ServerRuntime {
	/**
	 * Build and cache the server-side `ManagedRuntime`.
	 *
	 * @since 2.0.0
	 * @param layer - Optional Effect layer to provide to the runtime.
	 * @returns The configured ManagedRuntime.
	 */
	static make<R = never>(layer?: Layer.Layer<R>): ManagedRuntime.ManagedRuntime<R, never> {
		const should_replace_dev_runtime =
			current_server_runtime !== undefined && is_vite_dev_ssr();

		/**
		 * Keep duplicate production initialization loud while allowing SvelteKit's
		 * dev server to re-run hooks.server.ts after an HMR invalidation.
		 */
		if (current_server_runtime && !should_replace_dev_runtime) {
			throw new RuntimeAlreadyInitializedError("ServerRuntime");
		}

		if (should_replace_dev_runtime) {
			reset_server_runtime();
		}

		const runtime = ManagedRuntime.make(layer ?? (Layer.empty as unknown as Layer.Layer<R>));

		current_server_runtime = runtime as ManagedRuntime.ManagedRuntime<unknown, never>;
		current_server_dispatcher = new InternalDispatcher(
			runtime as unknown as ManagedRuntimeType<unknown, unknown>,
		);

		return runtime;
	}
}

let current_server_runtime: ManagedRuntime.ManagedRuntime<unknown, never> | undefined;
let current_server_dispatcher: InternalDispatcher | undefined;

/**
 * Returns the active server runtime, creating a default one if needed.
 *
 * @example
 * ```ts
 * const runtime = get_server_runtime_or_throw();
 * ```
 *
 * @since 2.0.0
 * @returns The current ManagedRuntime instance.
 */
export function get_server_runtime_or_throw(): ManagedRuntime.ManagedRuntime<unknown, never> {
	if (!current_server_runtime) {
		current_server_runtime = ManagedRuntime.make(Layer.empty) as ManagedRuntime.ManagedRuntime<
			unknown,
			never
		>;
	}

	return current_server_runtime;
}

export function get_server_dispatcher(): InternalDispatcher {
	current_server_dispatcher ??= new InternalDispatcher(
		get_server_runtime_or_throw() as unknown as ManagedRuntimeType<unknown, unknown>,
	);

	return current_server_dispatcher;
}

function is_vite_dev_ssr(): boolean {
	const env = (import.meta as ViteImportMeta).env;

	return env?.DEV === true && env?.SSR === true && env.MODE !== "test";
}

export function reset_server_runtime(): void {
	const dispatcher = current_server_dispatcher;
	const runtime = current_server_runtime;

	current_server_dispatcher = undefined;
	current_server_runtime = undefined;

	if (dispatcher) {
		dispatcher.dispose();

		return;
	}

	void runtime?.dispose().catch((error: unknown) => {
		queueMicrotask(() => {
			throw error;
		});
	});
}
