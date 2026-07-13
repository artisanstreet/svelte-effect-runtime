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

export class Dispatcher {
	static emit<A, F>(event: MarkupValueEvent<A, F>): A | F;
	static emit<A>(event: MarkupPromiseEvent<A>): Promise<A>;
	static emit<A>(event: MarkupRunEvent<A>): Promise<A>;
	static emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A>;
	static emit<A, F>(event: DispatcherEvent<A, F>): A | F | Promise<A> {
		return get_dispatcher().emit(event);
	}
}

export function get_dispatcher(): RuntimeDispatcher {
	if (typeof document === "undefined") {
		return get_server_dispatcher();
	}

	return get_client_dispatcher();
}
