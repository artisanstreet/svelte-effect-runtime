import type {
	ComponentScope,
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

export class Dispatcher {
	static emit<A, F>(event: MarkupValueEvent<A, F>): A | F;
	static emit<A>(event: MarkupPromiseEvent<A>): Promise<A>;
	static emit<A>(event: MarkupRunEvent<A>): Promise<A>;
	static emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A>;
	static emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A> {
		return get_dispatcher().emit(event);
	}

	/**
	 * Runs `fn` with `scope` as the active component scope so emitted work is
	 * bound to the calling component's lifetime.
	 */
	static with_scope<T>(scope: ComponentScope, fn: () => T): T {
		return get_dispatcher().with_scope(scope, fn);
	}
}

export function get_dispatcher(): RuntimeDispatcher {
	if (typeof document === "undefined") {
		return get_server_dispatcher();
	}

	return get_client_dispatcher();
}
