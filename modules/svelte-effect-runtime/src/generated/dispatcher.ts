import type {
	Dispatcher as RuntimeDispatcher,
	DispatcherEvent,
	MarkupPromiseEvent,
	MarkupRunEvent,
	MarkupValueEvent,
} from "$/dispatcher.ts";
import { get_dispatcher as get_client_dispatcher } from "$/dispatcher.ts";
import { get_server_dispatcher } from "$/server/runtime.ts";

export { Code } from "$/dispatcher.ts";
export type {
	DispatcherEvent,
	MarkupPromiseEvent,
	MarkupPromiseOptions,
	MarkupRunEvent,
	MarkupValueEvent,
} from "$/dispatcher.ts";

/**
 * Facade used by transform-generated component code to dispatch runtime
 * events through the current client or server dispatcher.
 *
 * @example
 * ```ts
 * const value = Dispatcher.emit({
 *   type: Code.Markup.Value,
 *   id: "Component.svelte:1:2",
 *   deps: [],
 *   fallback: undefined,
 *   fn: function* () {
 *     return yield* Effect.succeed(1);
 *   },
 * });
 * ```
 *
 * @since 3.3.0
 * @internal
 */
export class Dispatcher {
	/**
	 * Emits a transform-generated dispatcher event.
	 *
	 * @example
	 * ```ts
	 * const promise = Dispatcher.emit({
	 *   type: Code.Markup.Promise,
	 *   id: "Component.svelte:1:2",
	 *   deps: [],
	 *   fn: function* () {
	 *     return yield* Effect.succeed(1);
	 *   },
	 * });
	 * ```
	 *
	 * @since 3.3.0
	 * @param event - Generated event describing the dispatcher operation to run.
	 * @returns The result produced by the active dispatcher.
	 */
	static emit<A, F>(event: MarkupValueEvent<A, F>): A | F;
	static emit<A>(event: MarkupPromiseEvent<A>): Promise<A>;
	static emit<A>(event: MarkupRunEvent<A>): Promise<A>;
	static emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A>;
	static emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A> {
		return get_dispatcher().emit(event);
	}
}

/**
 * Returns the dispatcher appropriate for generated component code.
 *
 * @example
 * ```ts
 * const dispatcher = get_dispatcher();
 * ```
 *
 * @since 3.0.1
 * @returns The server dispatcher during SSR, otherwise the client dispatcher.
 */
export function get_dispatcher(): RuntimeDispatcher {
	if (typeof document === "undefined") {
		return get_server_dispatcher();
	}

	return get_client_dispatcher();
}
