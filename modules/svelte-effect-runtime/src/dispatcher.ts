export {
	Code,
	ComponentScopeRef,
	Dispatcher,
	get_dispatcher,
	reset_dispatcher,
} from "./dispatcher/index.ts";
export { ComponentScope } from "./dispatcher/scope.ts";
export type {
	DispatcherEvent,
	Dispose,
	MarkupPromiseEvent,
	MarkupPromiseOptions,
	MarkupRunEvent,
	MarkupValueEvent,
	PromiseOptions,
	ValueOptions,
} from "./dispatcher/types.ts";
