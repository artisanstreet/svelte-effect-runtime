# SER Error Catalog

Every SER diagnostic, its trigger, and the prescribed response. Most of these
errors exist precisely to reject the anti-patterns this skill bans — when one
fires, fix the source toward SER idiom; never suppress, catch-and-ignore, or
rewrite valid SER syntax into plain Svelte.

`RuntimeError` is the JavaScript base class for SER-authored exceptions;
production code always throws a concrete subclass. Catching only the base
loses the failed subsystem — match the specific class.

## Compile-time transform errors

Raised synchronously by the Vite/SER transform. These are source defects: the
build points at the exact expression.

| Error | Trigger | Fix |
| --- | --- | --- |
| `YieldStarInEventCallbackError` | Event attribute's whole expression is an arrow/function containing `yield*`: `onclick={() => yield* Save()}` | Direct form: `onclick={yield* Save()}` — SER generates the callback |
| `AsyncEffectInEventCallbackError` | Event expression starts at a valid boundary but a `yield*` is nested inside an opaque non-generator callback: `onclick={yield* Effect.try(() => yield* Save())}` | Keep all effect work at the top level of the event body; use generator-form combinators or restructure into an Effect-returning helper |
| `AsyncEffectInSyncRuneError` | `yield*` in a rune outside the async-compatible set (`$derived`, `$state`, `$state.raw`, `$state.snapshot`, `$bindable`), or directly in the first callback of `$derived.by`/`$effect`/`$effect.pre`/`$effect.root` | Move the effect to a top-level script statement or supported rune initializer; sync rune callbacks stay synchronous |
| `AwaitInEffectWorkError` | One statement mixes a top-level `await` with a lowered top-level `yield*`: `record(await transform(yield* Load()))` | Separate statements; better, replace the `await` with a `tryPromise`-wrapped step yielded on its own |
| `UnsupportedMarkupEffectPositionError` | `yield*` in an unsupported markup position — ordinary component/element props (`<Widget value={yield* Load()} />`), `{@debug ...}` | Resolve in a declaration tag first: `{const value = yield* Load()}` then `<Widget {value} />` |
| `PreprocessError` `[ASYNC_EFFECT_IN_CLASS_MEMBER]` | Top-level `yield*` in a class field initializer | Yield in a script effect statement, then assign the value to the instance |

## Declaration-time server factory errors

Raised while a `.remote.ts` module evaluates, before any request.

| Error | Trigger | Fix |
| --- | --- | --- |
| `UncheckedQueryHandlerMissingError` (same for `...Command...`, `...Form...`, `...LiveQuery...`, `...Prerender...`) | `Query("unchecked")` etc. without a handler — the sentinel only disables validation, it is not a program | Supply the handler as the second argument (for `Prerender` it must be callable — an options object does not count) |
| `BatchQueryHandlerMissingError` | `Query.batch` without a batch handler (it has no inputless overload) | Supply the handler receiving all inputs and returning the per-input resolver |
| `ServerOnlyImportError` | A server-only export (`Query`, `Command`, `Form`, `Prerender`, `Error`, `Redirect`, `RequestEvent`, `ServerRuntime.make`, …) invoked from the package root without SER's rewrite — plugin missing, or the file is not `*.remote.ts` / `*.server.ts` / `hooks.server.ts` | Install `effect()` in Vite and declare server code in recognized filenames |
| `SvelteKitServerExportUnavailableError` | SER's internal `$app/server` shim executed outside SvelteKit's compilation environment | Run through SvelteKit/Vite; never import SER internals directly |
| `RemoteHelperContextError` | A SvelteKit remote helper ran outside route/request context — declaration outside a valid `*.remote.ts` route module, or tooling without SvelteKit's request store | Declare remote functions in route-adjacent `*.remote.ts` modules and execute via SvelteKit |
| `RemoteHelperError` | A non-`Error` value (`throw "failed"`, `throw 42`) thrown at a remote helper boundary | Throw `Error` instances — or better, use typed effect failures instead of throwing |

## Runtime lifecycle errors

| Error | Trigger | Fix |
| --- | --- | --- |
| `RuntimeAlreadyInitializedError` | Second `ClientRuntime.make` / `ServerRuntime.make` — including after a lazy default runtime was already installed by earlier effect work | Call `make` exactly once, in the `init` hook, before any effect runs (HMR re-init of `hooks.server.ts` in Vite dev SSR is the sanctioned exception) |
| `RequestEventUnavailableError` | `yield* RequestEvent` outside a request-provided context: module init, startup, detached work | Read `RequestEvent` only inside a remote/live/`Handler` handler or Effects it calls |
| `DispatcherDisposedError` | `dispatcher.promise/run` after component teardown — delayed task, external callback, or stale reference outlived its component (rejected Promise, not a throw) | Do not retain effect work past component life; let SER own scheduling; observe returned Promises |
| `EmptyStreamYieldError` | Value-style `yield*` on a Stream that completed without emitting (typed failure via `Effect.fail`) | Handle in the error channel, or consume with `Stream.runForEach` when zero-or-more elements is the real shape |
| `InvalidLiveQueryReturnError` | `Query.live` handler returned anything but a Stream — value, array, Promise, iterable, generator object, or `Effect.succeed(stream)` | Return the `Stream` itself; wrap native sources with `Stream.fromIterable` / `Stream.fromAsyncIterable` |
| `InvalidQueryFactoryError` / `InvalidCommandFactoryError` / `InvalidLiveQueryFactoryError` | Generated client adapter received a malformed native factory — stale generated code, compiler/runtime version mismatch, or direct use of SER internals. The live variant also fires when `Live.reconnect` is called on a plain Stream lacking SER's remote transport metadata | Regenerate/align versions; never call internal adapters; only pass SER-created live streams (or operator-derived ones) to `Live.status`/`Live.reconnect` |

## Tagged remote failures (client error channel)

These are tagged **data**, not `Error` subclasses. They arrive in the Effect
error channel of remote calls — recover with `Effect.catchTag("<Tag>", ...)`.

| Tag | Meaning | Handling |
| --- | --- | --- |
| `RemoteValidationError` | Form input rejected; `issues` (typed paths), `status` (default 400), `body` | Expected control flow — surface issues to the UI |
| `RemoteHttpError` | Failure with a trustworthy HTTP `status` (401/404/503…) but no more specific SER tag | Branch on `status` for auth, missing-resource, retry decisions |
| `RemoteTransportError` | Protocol broke before status or typed failure could be established; inspect `cause` (often a specific SER class below) and `body` | Diagnose transport/versions; do not treat as domain failure |
| `FormError` | Server-side value produced by the Form `invalid` proxy (`_tag`, `issues`); SvelteKit routes it back to fields | The idiom itself — produced by `return yield* invalid.path(...)` |

`RemoteTransportError.cause` may hold: `RemoteFormEndpointMissingError`
(missing action id/base URL — stale generated module or internal-adapter
misuse), `InvalidRemoteFormResponseError` (envelope matches neither
error/result protocol — version skew; raw value kept in `envelope`),
`UnsupportedRemoteFormResponseError` (result envelope without a decodable
payload — payload-contract skew), `RemoteErrorDecodeError` (marked serialized
failure whose payload would not decode; wire value in `raw`).

Your own tagged domain errors also cross the wire typed — prefer catching
those tags over any generic fallback.
