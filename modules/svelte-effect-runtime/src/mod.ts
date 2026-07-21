import type {
	CommandFactory,
	FormFactory,
	PrerenderFactory,
	QueryFactory,
	ServerRuntimeFactory,
} from "$/server/types.ts";
import type { ErrorEffectFactory, RedirectEffectFactory } from "$/server/control-flow.ts";
import type { RequestEvent as RequestEventShape } from "$/server/runtime.ts";
import { Dispatcher as InternalDispatcher } from "$/dispatcher.ts";
import type { Context, Layer, ManagedRuntime } from "effect";
import { ServerOnlyImportError } from "$/errors.ts";

/**
 * Public API surface for `svelte-effect-runtime`.
 *
 * Call {@link ClientRuntime.make} in `hooks.client.ts`, call
 * {@link ServerRuntime.make} in `hooks.server.ts`, and let the Vite plugin
 * route server-only helpers to the server entrypoint automatically.
 *
 * @module
 */

/**
 * Client-side runtime singleton. Call `ClientRuntime.make(layer?)` once
 * in `hooks.client.ts` to provide services to every component's effect
 * blocks.
 *
 * If never called, a default empty-layer runtime is created lazily on
 * the first `yield*` expression.
 *
 * @example
 * ```ts
 * import { ClientRuntime } from "svelte-effect-runtime";
 * import { Db } from "./db.ts";
 *
 * ClientRuntime.make(Db.Live);
 * ```
 *
 * @since 2.0.0
 */
export class ClientRuntime {
	/**
	 * Build and cache the client-side dispatcher runtime.
	 *
	 * @since 2.0.0
	 * @param layer - Optional Effect layer to provide to the runtime.
	 */
	static make<R = never>(layer?: Layer.Layer<R>): void {
		InternalDispatcher.make(layer);
	}
}

/**
 * Server-side runtime singleton export. In SvelteKit server files the Vite
 * plugin rewrites root imports to `svelte-effect-runtime/server`, so this
 * name resolves to the real server implementation before it is evaluated.
 *
 * @example
 * ```ts
 * import { ServerRuntime } from "svelte-effect-runtime";
 *
 * ServerRuntime.make();
 * ```
 *
 * @since 2.0.0
 */
export const ServerRuntime: ServerRuntimeFactory = make_server_only_class("ServerRuntime") as never;

/**
 * Remote query factory export for `.remote.ts` files imported from the root
 * entrypoint. The Vite plugin rewrites it to the real server implementation.
 *
 * @example
 * ```ts
 * import { Query } from "svelte-effect-runtime";
 *
 * export const GetPosts = Query(Effect.succeed([]));
 * ```
 *
 * @since 2.0.0
 */
export const Query: QueryFactory = Object.assign(make_server_only_function("Query"), {
	batch: make_server_only_function("Query.batch"),
	live: make_server_only_function("Query.live"),
}) as never;

/**
 * Remote command factory export for `.remote.ts` files imported from the root
 * entrypoint. The Vite plugin rewrites it to the real server implementation.
 *
 * @example
 * ```ts
 * import { Command } from "svelte-effect-runtime";
 *
 * export const SavePost = Command(Schema.String, (id) => Effect.succeed(id));
 * ```
 *
 * @since 2.0.0
 */
export const Command: CommandFactory = make_server_only_function("Command") as never;

/**
 * SvelteKit HTTP error control-flow export for `.remote.ts` files imported
 * from the root entrypoint. The Vite plugin rewrites it to the real server
 * implementation.
 *
 * @example
 * ```ts
 * import { Error } from "svelte-effect-runtime";
 *
 * return yield* Error("NotFound", "Post not found");
 * ```
 *
 * @since 2.3.0
 */
export const Error: ErrorEffectFactory = make_server_only_function("Error") as never;

/**
 * Remote form factory export for `.remote.ts` files imported from the root
 * entrypoint. The Vite plugin rewrites it to the real server implementation.
 *
 * @example
 * ```ts
 * import { Form } from "svelte-effect-runtime";
 *
 * export const CreatePost = Form(PostInput, ({ data }) => Effect.succeed(data));
 * ```
 *
 * @since 2.0.0
 */
export const Form: FormFactory = make_server_only_function("Form") as never;

/**
 * Remote prerender factory export for `.remote.ts` files imported from the
 * root entrypoint. The Vite plugin rewrites it to the real server
 * implementation.
 *
 * @example
 * ```ts
 * import { Prerender } from "svelte-effect-runtime";
 *
 * export const GetBuildInfo = Prerender(() => Effect.succeed("ready"));
 * ```
 *
 * @since 2.0.0
 */
export const Prerender: PrerenderFactory = make_server_only_function("Prerender") as never;

export { Live } from "$/live.ts";

/**
 * SvelteKit redirect control-flow export for `.remote.ts` files imported from
 * the root entrypoint. The Vite plugin rewrites it to the real server
 * implementation.
 *
 * @example
 * ```ts
 * import { Redirect } from "svelte-effect-runtime";
 *
 * return yield* Redirect("SeeOther", "/posts");
 * ```
 *
 * @since 2.3.0
 */
export const Redirect: RedirectEffectFactory = make_server_only_function("Redirect") as never;

/**
 * Current SvelteKit request event service export for `.remote.ts` files
 * imported from the root entrypoint. The Vite plugin rewrites it to the real
 * server implementation.
 *
 * @example
 * ```ts
 * import { RequestEvent } from "svelte-effect-runtime";
 *
 * const event = yield* RequestEvent;
 * ```
 *
 * @since 2.0.0
 */
export const RequestEvent: Context.Reference<RequestEventShape> = make_server_only_function(
	"RequestEvent",
) as never;

/**
 * Returns the active server runtime when imported from a server file. The Vite
 * plugin rewrites root imports to the real server implementation.
 *
 * @example
 * ```ts
 * import { get_server_runtime_or_throw } from "svelte-effect-runtime";
 *
 * const runtime = get_server_runtime_or_throw();
 * ```
 *
 * @since 2.0.0
 */
export const get_server_runtime_or_throw: () => ManagedRuntime.ManagedRuntime<unknown, never> =
	make_server_only_function("get_server_runtime_or_throw") as never;

export type {
	FormError,
	FormIssue,
	RemoteFailure,
	RemoteHttpError,
	RemoteTransportError,
	RemoteValidationError,
} from "$/remote/shared.ts";

export {
	AsyncEffectInEventCallbackError,
	AsyncEffectInSyncRuneError,
	AwaitInEffectWorkError,
	BatchQueryHandlerMissingError,
	DispatcherDisposedError,
	EmptyStreamYieldError,
	ScopeDisposedError,
	InvalidCommandFactoryError,
	InvalidLiveQueryFactoryError,
	InvalidLiveQueryReturnError,
	InvalidPrerenderFactoryError,
	InvalidQueryFactoryError,
	InvalidRemoteFormResponseError,
	InvalidYieldableError,
	PreprocessError,
	RemoteErrorDecodeError,
	RemoteFormEndpointMissingError,
	RemoteHelperContextError,
	RemoteHelperError,
	RequestEventUnavailableError,
	RuntimeAlreadyInitializedError,
	RuntimeError,
	ServerOnlyImportError,
	SvelteKitServerExportUnavailableError,
	UncheckedCommandHandlerMissingError,
	UncheckedFormHandlerMissingError,
	UncheckedLiveQueryHandlerMissingError,
	UncheckedPrerenderHandlerMissingError,
	UncheckedQueryHandlerMissingError,
	UnsupportedMarkupEffectPositionError,
	UnsupportedRemoteFormResponseError,
	YieldStarInEventCallbackError,
} from "$/errors.ts";

export {
	is_form_error,
	is_remote_http_error,
	is_remote_transport_error,
	is_remote_validation_error,
} from "$/remote/shared.ts";

export { effect, type EffectOptions } from "$/compiler.ts";

export type {
	ErrorBody,
	ErrorEffectFactory,
	ErrorProperties,
	ErrorStatus,
	ErrorStatusName,
	RedirectEffectFactory,
	RedirectOptions,
	RedirectStatus,
	RedirectStatusName,
} from "$/server/control-flow.ts";

export type { LiveFactory, LiveStatus, RemoteLiveStream } from "$/live.ts";

export type {
	CommandFactory,
	EffectLike,
	EffectRemoteBatchHandler,
	EffectRemoteCommand,
	EffectRemoteCommandCall,
	EffectRemoteForm,
	EffectRemoteFunction,
	EffectRemoteLiveQuery,
	EffectRemoteLiveQueryFunction,
	EffectRemotePrerender,
	EffectRemotePrerenderFunction,
	EffectRemoteQuery,
	EffectRemoteQueryFunction,
	FormFactory,
	FormInvalid,
	PrerenderFactory,
	PrerenderInputs,
	PrerenderOptions,
	QueryBatchFactory,
	QueryFactory,
	QueryLiveFactory,
	RemoteFormHandler,
	RemoteHandler,
	RemoteLiveHandler,
	RemoteLiveSource,
	SchemaEncodedInput,
	SchemaInput,
	ServerRuntimeFactory,
	StandardSchema,
	StandardSchemaInput,
	StandardSchemaOutput,
} from "$/server/types.ts";

function make_server_only_class(name: string): unknown {
	return class ServerOnlyRuntime {
		static make(): never {
			throw make_server_only_error(name);
		}
	};
}

function make_server_only_function(name: string): (...args: unknown[]) => never {
	return (..._args: unknown[]): never => {
		throw make_server_only_error(name);
	};
}

function make_server_only_error(name: string): globalThis.Error {
	return new ServerOnlyImportError(name);
}
