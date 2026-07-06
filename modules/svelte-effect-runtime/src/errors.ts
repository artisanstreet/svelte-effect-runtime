/**
 * Base class for runtime-authored errors. The class gives every local failure
 * a stable JavaScript error name while preserving the technical message that
 * reaches Vite, SvelteKit, and test output.
 *
 * @example
 * ```ts
 * throw new RuntimeError("Invariant violated.");
 * ```
 *
 * @since 2.4.0
 * @param message - Technical diagnostic message describing the failed runtime
 *   invariant.
 * @returns A runtime-authored Error instance.
 */
export class RuntimeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RuntimeError";
	}
}

/**
 * Formats a runtime-owned error message with a stable screaming-case code.
 *
 * @example
 * ```ts
 * throw new Error(make_error_message("DISPATCHER_DISPOSED", "Dispatcher has been disposed"));
 * ```
 *
 * @since 2.0.0
 * @param code - Stable screaming-case identifier for the error category.
 * @param message - Human-readable error message without the leading code.
 * @returns The complete error message prefixed with the stable code.
 */
export function make_error_message(code: string, message: string): string {
	return `[${code}]: ${message}`;
}

/**
 * Base error class for all preprocessor errors emitted during script and
 * markup transformation. Carries the source filename so error messages can
 * reference the affected file.
 *
 * @example
 * ```ts
 * throw new PreprocessError("Component.svelte: invalid transform input.", "Component.svelte");
 * ```
 *
 * @since 2.0.0
 * @param message - Technical diagnostic message for the transform failure.
 * @param filename - Source filename that triggered the transform failure.
 * @returns A preprocessor Error instance with source file context.
 */
export class PreprocessError extends RuntimeError {
	/**
	 * The source filename that triggered this error.
	 *
	 * @since 2.0.0
	 */
	readonly filename: string;

	constructor(message: string, filename: string) {
		super(message);
		this.name = "PreprocessError";
		this.filename = filename;
	}
}

/**
 * Retained for compatibility when callers need a structured representation of
 * possible Vite plugin ordering conflicts.
 *
 * @example
 * ```ts
 * throw new VitePreTransformPluginConflictError(["wuchale"]);
 * ```
 *
 * @since 2.4.0
 * @param plugin_names - Names of Vite plugins that declare pre-transform
 *   priority and may parse raw `.svelte` files before SER lowers them.
 * @returns A runtime-authored Error describing the possible plugin ordering
 *   conflict.
 */
export class VitePreTransformPluginConflictError extends RuntimeError {
	/**
	 * Names of conflicting Vite plugins.
	 *
	 * @since 2.4.0
	 */
	readonly plugin_names: readonly string[];

	constructor(plugin_names: readonly string[]) {
		super(
			[
				`Svelte Effect Runtime noticed possible Vite plugin ordering conflicts.`,
				"",
				`These plugins run before normal Svelte component transforms:`,
				...plugin_names.map((plugin_name) => `  - ${plugin_name}`),
				"",
				`This is usually fine, but if you see Svelte parser errors around <script effect>`,
				`or yield* in components, one of those plugins may be reading .svelte files before`,
				`SER has lowered its syntax.`,
			].join("\n"),
		);
		this.name = "VitePreTransformPluginConflictError";
		this.plugin_names = plugin_names;
	}
}

/**
 * Thrown when a statement mixes JavaScript `await` with Effect `yield*` work
 * that must be lowered into an `Effect.gen` program.
 *
 * @example
 * ```ts
 * throw new AwaitInEffectWorkError("Component.svelte", "const value = await load();");
 * ```
 *
 * @since 2.0.0
 * @param filename - Source filename containing the unsupported statement.
 * @param statement_text - Full source text for the statement containing
 *   mixed async work.
 * @returns A preprocessor Error instance with statement context.
 */
export class AwaitInEffectWorkError extends PreprocessError {
	/**
	 * The full text of the problematic statement containing mixed async work.
	 *
	 * @since 2.0.0
	 */
	readonly statement_text: string;

	constructor(filename: string, statement_text: string) {
		super(
			[
				make_error_message(
					"AWAIT_IN_EFFECT_WORK",
					`${filename}: await cannot be mixed with yield* in Effect work.`,
				),
				`Top-level await is supported as ordinary Svelte async rendering, but statements lowered into Effect.gen must use yield* for async Effect work.`,
				"",
				`Problematic statement:`,
				statement_text,
			].join("\n"),
			filename,
		);
		this.name = "AwaitInEffectWorkError";
		this.statement_text = statement_text;
	}
}

/**
 * Thrown when async Effect work appears inside a Svelte rune position that
 * must stay synchronous.
 *
 * @example
 * ```ts
 * throw new AsyncEffectInSyncRuneError("$derived", "$derived(yield* load())", "Component.svelte");
 * ```
 *
 * @since 2.0.0
 * @param rune_name - Name of the Svelte rune containing the unsupported async
 *   Effect work.
 * @param expression_text - Full source text for the rune expression.
 * @param filename - Source filename containing the unsupported rune.
 * @returns A preprocessor Error instance with rune source context.
 */
export class AsyncEffectInSyncRuneError extends PreprocessError {
	/**
	 * The name of the rune that contained async Effect work.
	 *
	 * @since 2.0.0
	 */
	readonly rune_name: string;

	/**
	 * The full text of the expression that triggered the error.
	 *
	 * @since 2.0.0
	 */
	readonly expression_text: string;

	constructor(rune_name: string, expression_text: string, filename: string) {
		super(
			[
				make_error_message(
					"ASYNC_EFFECT_IN_SYNC_RUNE",
					`${filename}: yield* cannot be used inside ${rune_name}().`,
				),
				`${rune_name}() must stay synchronous. Do not put async Effect work inside this rune.`,
				"",
				`Problematic expression:`,
				expression_text,
			].join("\n"),
			filename,
		);
		this.name = "AsyncEffectInSyncRuneError";
		this.rune_name = rune_name;
		this.expression_text = expression_text;
	}
}

/**
 * Thrown when async Effect work appears inside a non-generator callback nested
 * in a markup event handler.
 *
 * @example
 * ```ts
 * throw new AsyncEffectInEventCallbackError(
 *   "Component.svelte",
 *   "Effect.try(() => yield* save())",
 * );
 * ```
 *
 * @since 2.0.0
 * @param filename - Source filename containing the invalid event handler.
 * @param expression_text - Event handler expression that contains the nested
 *   unsupported async Effect work.
 * @returns A preprocessor Error instance with event expression context.
 */
export class AsyncEffectInEventCallbackError extends PreprocessError {
	/**
	 * The full text of the problematic event handler body.
	 *
	 * @since 2.0.0
	 */
	readonly expression_text: string;

	constructor(filename: string, expression_text: string) {
		super(
			[
				make_error_message(
					"ASYNC_EFFECT_IN_EVENT_CALLBACK",
					`${filename}: yield* cannot be used inside a nested non-generator callback in a markup event handler.`,
				),
				`Move the yield* to the event handler body. Effect.try and Effect.sync callbacks are plain synchronous JavaScript; do not call Effect-returning functions inside them.`,
				"",
				`Run the remote Effect directly:`,
				`  onclick={yield* UpvotePost(id)}`,
				"",
				`Recover from remote failures by composing the Effect value:`,
				`  onclick={yield* UpvotePost(id).pipe(Effect.catch(() => Effect.void))}`,
				"",
				`Problematic expression:`,
				expression_text,
			].join("\n"),
			filename,
		);
		this.name = "AsyncEffectInEventCallbackError";
		this.expression_text = expression_text;
	}
}

/**
 * Thrown when an event handler callback contains the old raw `yield*`
 * shorthand. Effectful event handlers must put `yield*` directly in the event
 * attribute so the callback boundary is generated by the markup runtime.
 *
 * @example
 * ```ts
 * throw new YieldStarInEventCallbackError("Component.svelte", "() => yield* save()");
 * ```
 *
 * @since 2.0.0
 * @param filename - Svelte component filename used to identify where the
 *   invalid event handler callback was found.
 * @param expression_text - Original event handler callback text that contained
 *   `yield*` and should be rewritten as a direct event Effect expression.
 * @returns A preprocessor Error instance with event callback context.
 */
export class YieldStarInEventCallbackError extends PreprocessError {
	/**
	 * The full text of the problematic event handler callback.
	 *
	 * @since 2.0.0
	 */
	readonly expression_text: string;

	constructor(filename: string, expression_text: string) {
		super(
			[
				make_error_message(
					"ASYNC_EFFECT_IN_EVENT_HANDLER_CALLBACK",
					`${filename}: yield* in markup event handlers must be written directly as the event attribute value.`,
				),
				`SER generates the event callback for effectful event handlers; do not put yield* inside a JavaScript callback.`,
				"",
				`Use this form:`,
				`  onclick={yield* UpvotePost(id)}`,
				"",
				`Instead of this form:`,
				`  onclick={() => yield* UpvotePost(id)}`,
				"",
				`Problematic expression:`,
				expression_text,
			].join("\n"),
			filename,
		);
		this.name = "YieldStarInEventCallbackError";
		this.expression_text = expression_text;
	}
}

/**
 * Thrown when async Effect work appears in a markup position SER cannot lower
 * safely.
 *
 * @example
 * ```ts
 * throw new UnsupportedMarkupEffectPositionError(
 *   "Component.svelte",
 *   "value={yield* load()}",
 * );
 * ```
 *
 * @since 2.4.2
 * @param filename - Source filename containing the unsupported markup.
 * @param expression_text - The unsupported markup expression text.
 * @returns A preprocessor Error instance with markup source context.
 */
export class UnsupportedMarkupEffectPositionError extends PreprocessError {
	/**
	 * The unsupported markup expression text.
	 *
	 * @since 2.4.2
	 */
	readonly expression_text: string;

	constructor(filename: string, expression_text: string) {
		super(
			[
				make_error_message(
					"UNSUPPORTED_MARKUP_EFFECT_POSITION",
					`${filename}: yield* cannot be used in this markup position.`,
				),
				`Move the Effect work into a supported expression tag, block expression, render expression, declaration tag, or event handler.`,
				"",
				`Problematic expression:`,
				expression_text,
			].join("\n"),
			filename,
		);
		this.name = "UnsupportedMarkupEffectPositionError";
		this.expression_text = expression_text;
	}
}

/**
 * Thrown when the request-scoped SvelteKit event context is read outside a
 * remote handler.
 *
 * @example
 * ```ts
 * throw new RequestEventUnavailableError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing missing request context.
 */
export class RequestEventUnavailableError extends RuntimeError {
	constructor() {
		super(
			"RequestEvent is only available while a SER remote handler is executing inside a request-scoped Effect context.",
		);
		this.name = "RequestEventUnavailableError";
	}
}

/**
 * Thrown when an unchecked Query declaration omits the handler.
 *
 * @example
 * ```ts
 * throw new UncheckedQueryHandlerMissingError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing the invalid Query overload usage.
 */
export class UncheckedQueryHandlerMissingError extends RuntimeError {
	constructor() {
		super(
			"Query('unchecked', handler) requires a concrete handler function as the second argument; the unchecked schema sentinel cannot execute by itself.",
		);
		this.name = "UncheckedQueryHandlerMissingError";
	}
}

/**
 * Thrown when a batch Query declaration omits the batch handler.
 *
 * @example
 * ```ts
 * throw new BatchQueryHandlerMissingError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing the invalid batch Query overload usage.
 */
export class BatchQueryHandlerMissingError extends RuntimeError {
	constructor() {
		super(
			"Query.batch requires a concrete batch handler function; the batch helper cannot infer a handler from schema metadata alone.",
		);
		this.name = "BatchQueryHandlerMissingError";
	}
}

/**
 * Thrown when an unchecked live Query declaration omits the handler.
 *
 * @example
 * ```ts
 * throw new UncheckedLiveQueryHandlerMissingError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing the invalid live Query overload usage.
 */
export class UncheckedLiveQueryHandlerMissingError extends RuntimeError {
	constructor() {
		super(
			"Query.live('unchecked', handler) requires a concrete handler function as the second argument; the unchecked schema sentinel cannot produce a live source.",
		);
		this.name = "UncheckedLiveQueryHandlerMissingError";
	}
}

/**
 * Thrown when an unchecked Command declaration omits the handler.
 *
 * @example
 * ```ts
 * throw new UncheckedCommandHandlerMissingError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing the invalid Command overload usage.
 */
export class UncheckedCommandHandlerMissingError extends RuntimeError {
	constructor() {
		super(
			"Command('unchecked', handler) requires a concrete handler function as the second argument; the unchecked schema sentinel cannot execute a command.",
		);
		this.name = "UncheckedCommandHandlerMissingError";
	}
}

/**
 * Thrown when an unchecked Form declaration omits the handler.
 *
 * @example
 * ```ts
 * throw new UncheckedFormHandlerMissingError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing the invalid Form overload usage.
 */
export class UncheckedFormHandlerMissingError extends RuntimeError {
	constructor() {
		super(
			"Form('unchecked', handler) requires a concrete handler function as the second argument; the unchecked schema sentinel cannot process form data.",
		);
		this.name = "UncheckedFormHandlerMissingError";
	}
}

/**
 * Thrown when an unchecked Prerender declaration omits the handler.
 *
 * @example
 * ```ts
 * throw new UncheckedPrerenderHandlerMissingError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing the invalid Prerender overload usage.
 */
export class UncheckedPrerenderHandlerMissingError extends RuntimeError {
	constructor() {
		super(
			"Prerender('unchecked', handler) requires a concrete handler function as the second argument; the unchecked schema sentinel cannot produce prerendered data.",
		);
		this.name = "UncheckedPrerenderHandlerMissingError";
	}
}

/**
 * Thrown when a live query handler resolves to a value that cannot be streamed.
 *
 * @example
 * ```ts
 * throw new InvalidLiveQueryReturnError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing the expected live query return protocol.
 */
export class InvalidLiveQueryReturnError extends RuntimeError {
	constructor() {
		super(
			"Query.live handler must return an Effect Stream, Iterable, or AsyncIterable; resolved values must expose a streaming protocol that SER can bridge to SvelteKit.",
		);
		this.name = "InvalidLiveQueryReturnError";
	}
}

/**
 * Thrown when a dispatcher operation is requested after disposal.
 *
 * @example
 * ```ts
 * throw new DispatcherDisposedError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing an invalid dispatcher lifecycle transition.
 */
export class DispatcherDisposedError extends RuntimeError {
	constructor() {
		super(
			"Dispatcher has been disposed; no new Effect fibers or promise bridges can be started after component teardown.",
		);
		this.name = "DispatcherDisposedError";
	}
}

/**
 * Thrown when an application attempts to configure a runtime after one has
 * already been initialized.
 *
 * @example
 * ```ts
 * throw new RuntimeAlreadyInitializedError("ClientRuntime");
 * ```
 *
 * @since 3.4.0
 * @param runtime_name - Public runtime API that was initialized more than once.
 * @returns An Error describing the invalid runtime lifecycle transition.
 */
export class RuntimeAlreadyInitializedError extends RuntimeError {
	constructor(runtime_name: string) {
		super(
			make_error_message(
				"RUNTIME_ALREADY_INITIALIZED",
				`${runtime_name}.make(...) cannot be called because the runtime has already been initialized. Configure it once during application startup, before any Effect-backed component, remote handler, or generated runtime code runs.`,
			),
		);
		this.name = "RuntimeAlreadyInitializedError";
	}
}

/**
 * Thrown when a generated or native remote query export is not callable.
 *
 * @example
 * ```ts
 * throw new InvalidQueryFactoryError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing an invalid query adapter input.
 */
export class InvalidQueryFactoryError extends RuntimeError {
	constructor() {
		super(
			"Invalid query factory: expected a function or an object exposing query/load methods from SvelteKit remote query generation.",
		);
		this.name = "InvalidQueryFactoryError";
	}
}

/**
 * Thrown when a generated or native remote live query export is not callable.
 *
 * @example
 * ```ts
 * throw new InvalidLiveQueryFactoryError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing an invalid live query adapter input.
 */
export class InvalidLiveQueryFactoryError extends RuntimeError {
	constructor() {
		super(
			"Invalid live query factory: expected a function or an object exposing a query method from SvelteKit remote live query generation.",
		);
		this.name = "InvalidLiveQueryFactoryError";
	}
}

/**
 * Thrown when a generated or native remote command export is not callable.
 *
 * @example
 * ```ts
 * throw new InvalidCommandFactoryError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing an invalid command adapter input.
 */
export class InvalidCommandFactoryError extends RuntimeError {
	constructor() {
		super(
			"Invalid command factory: expected a function or an object exposing an invoke method from SvelteKit remote command generation.",
		);
		this.name = "InvalidCommandFactoryError";
	}
}

/**
 * Thrown when the client-side form adapter cannot derive a remote endpoint.
 *
 * @example
 * ```ts
 * throw new RemoteFormEndpointMissingError();
 * ```
 *
 * @since 2.4.0
 * @returns An Error describing missing form transport metadata.
 */
export class RemoteFormEndpointMissingError extends RuntimeError {
	constructor() {
		super(
			"Form has no submit method or remote endpoint; the adapted SvelteKit form object does not expose an action id and no remote base URL was generated.",
		);
		this.name = "RemoteFormEndpointMissingError";
	}
}

/**
 * Thrown when a remote form response envelope is not an object with a response
 * type.
 *
 * @example
 * ```ts
 * throw new InvalidRemoteFormResponseError(envelope);
 * ```
 *
 * @since 2.4.0
 * @param envelope - Raw response envelope returned by the remote form endpoint.
 * @returns An Error describing malformed form response data.
 */
export class InvalidRemoteFormResponseError extends RuntimeError {
	/**
	 * Raw response envelope returned by the remote form endpoint.
	 *
	 * @since 2.4.0
	 */
	readonly envelope: unknown;

	constructor(envelope?: unknown) {
		super(
			"Invalid remote form response: expected an object envelope with a string type field returned by SvelteKit remote form transport.",
		);
		this.name = "InvalidRemoteFormResponseError";
		this.envelope = envelope;
	}
}

/**
 * Thrown when a remote form response has a well-formed envelope but an
 * unsupported response type or payload slot.
 *
 * @example
 * ```ts
 * throw new UnsupportedRemoteFormResponseError(envelope);
 * ```
 *
 * @since 2.4.0
 * @param envelope - Raw response envelope returned by the remote form endpoint.
 * @returns An Error describing unsupported form response data.
 */
export class UnsupportedRemoteFormResponseError extends RuntimeError {
	/**
	 * Raw response envelope returned by the remote form endpoint.
	 *
	 * @since 2.4.0
	 */
	readonly envelope: unknown;

	constructor(envelope?: unknown) {
		super(
			"Unsupported remote form response: expected a result envelope with a devalue-encoded result or data string.",
		);
		this.name = "UnsupportedRemoteFormResponseError";
		this.envelope = envelope;
	}
}

/**
 * Thrown when a serialized remote failure envelope cannot be decoded.
 *
 * @example
 * ```ts
 * throw new RemoteErrorDecodeError(raw);
 * ```
 *
 * @since 2.4.0
 * @param raw - Raw serialized remote failure payload that failed decoding.
 * @returns An Error describing a malformed remote failure payload.
 */
export class RemoteErrorDecodeError extends RuntimeError {
	/**
	 * Raw serialized remote failure payload that failed decoding.
	 *
	 * @since 2.4.0
	 */
	readonly raw: unknown;

	constructor(raw?: unknown) {
		super(
			"Failed to decode remote error payload: expected a devalue-encoded SER remote failure envelope compatible with the client decoder.",
		);
		this.name = "RemoteErrorDecodeError";
		this.raw = raw;
	}
}

/**
 * Thrown when a root server-only helper is imported without Vite rewriting.
 *
 * @example
 * ```ts
 * throw new ServerOnlyImportError("Query");
 * ```
 *
 * @since 2.4.0
 * @param export_name - Name of the server-only root export that was invoked.
 * @returns An Error describing a missing server rewrite.
 */
export class ServerOnlyImportError extends RuntimeError {
	/**
	 * Name of the server-only root export that was invoked.
	 *
	 * @since 2.4.0
	 */
	readonly export_name: string;

	constructor(export_name: string) {
		super(
			`${export_name} is only available in SvelteKit server files. Ensure the SER Vite plugin is enabled so root imports are rewritten to svelte-effect-runtime/server before execution.`,
		);
		this.name = "ServerOnlyImportError";
		this.export_name = export_name;
	}
}

/**
 * Thrown when the publish-time `$app/server` shim executes outside SvelteKit.
 *
 * @example
 * ```ts
 * throw new SvelteKitServerExportUnavailableError("query");
 * ```
 *
 * @since 2.4.0
 * @param export_name - Name of the `$app/server` export that was invoked.
 * @returns An Error describing an unavailable SvelteKit virtual module export.
 */
export class SvelteKitServerExportUnavailableError extends RuntimeError {
	/**
	 * Name of the `$app/server` export that was invoked.
	 *
	 * @since 2.4.0
	 */
	readonly export_name: string;

	constructor(export_name: string) {
		super(
			`SvelteKit virtual $app/server export ${export_name} is only available inside a SvelteKit server module.`,
		);
		this.name = "SvelteKitServerExportUnavailableError";
		this.export_name = export_name;
	}
}

/**
 * Thrown when a SvelteKit remote helper reports that it was called outside the
 * route-scoped remote module context.
 *
 * @example
 * ```ts
 * throw new RemoteHelperContextError("Query");
 * ```
 *
 * @since 2.4.0
 * @param helper_name - SER helper name that triggered the context failure.
 * @returns An Error describing the required `.remote.ts` placement.
 */
export class RemoteHelperContextError extends RuntimeError {
	/**
	 * SER helper name that triggered the context failure.
	 *
	 * @since 2.4.0
	 */
	readonly helper_name: string;

	constructor(helper_name: string) {
		super(
			make_error_message(
				"REMOTE_HELPER_CONTEXT",
				`${helper_name} was called outside a .remote.ts file. Ensure the file is named \`*.remote.ts\` and is located in a route directory so SvelteKit can bind remote helper context.`,
			),
		);
		this.name = "RemoteHelperContextError";
		this.helper_name = helper_name;
	}
}

/**
 * Thrown when a SvelteKit remote helper normalizes a non-Error thrown value.
 *
 * @example
 * ```ts
 * throw new RemoteHelperError("raw failure");
 * ```
 *
 * @since 2.4.0
 * @param value - Non-Error value thrown while creating a remote helper.
 * @returns An Error preserving the remote helper failure value.
 */
export class RemoteHelperError extends RuntimeError {
	/**
	 * Non-Error value that was normalized.
	 *
	 * @since 2.4.0
	 */
	readonly value: unknown;

	constructor(value: unknown) {
		super(make_error_message("REMOTE_HELPER_ERROR", String(value)));
		this.name = "RemoteHelperError";
		this.value = value;
	}
}

/**
 * Thrown when a non-Error value must be normalized into an Error instance.
 *
 * @example
 * ```ts
 * throw new UnknownRuntimeError("raw failure");
 * ```
 *
 * @since 2.4.0
 * @param value - Non-Error value that needs Error normalization.
 * @returns An Error preserving the string representation of an unknown value.
 */
export class UnknownRuntimeError extends RuntimeError {
	/**
	 * Non-Error value that was normalized.
	 *
	 * @since 2.4.0
	 */
	readonly value: unknown;

	constructor(value: unknown) {
		super(String(value));
		this.name = "UnknownRuntimeError";
		this.value = value;
	}
}
