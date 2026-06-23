# SER Runtime Audit

Date: 2026-06-22

## 2026-06-23 Reverification Run

Status: complete

### Reverification Goal

Re-run the runtime audit from a fresh tarball and fresh repro apps, then compare
the observed behavior against Effect's canonical success, failure, defect, and
interruption semantics. Treat the existing checked matrix as a hypothesis until
new evidence confirms it.

### Reverification Checklist

- [x] Build the current runtime package and produce a local tarball.
- [x] Install that tarball into at least one fresh SvelteKit repro app.
- [x] Verify package exports, packed files, declaration files, and server-only
      boundaries.
- [x] Verify client runtime behavior through Svelte preprocessing and the Vite
      plugin.
- [x] Verify `<script effect>` branches for success, failure, interrupt,
      dependency changes, SSR, and invalid syntax.
- [x] Verify markup `{yield* ...}` branches for plain expressions, event
      handlers, each/await/render contexts, callback lifting, and invalid nested
      yield branches.
- [x] Verify dispatcher branches for `fork`, `run`, `promise`, `value`, cleanup,
      cache hits, cache misses, dependency hashing, fallbacks, failures,
      defects, interruptions, injected runtimes, reset, and disposal.
- [x] Verify remote client wrappers for successful values, `Response` values,
      failed HTTP responses, serialized failures, validation failures, transport
      failures, pending state, descriptor copying, and form enhance callbacks.
- [x] Verify remote server helpers for query, batched query, live query,
      command, form, prerender, redirect, invalid, request-event, schema,
      wrappers, and runtime factories under SvelteKit request handling.
- [x] Verify public TypeScript behavior for all exported APIs and callback
      return contracts.
- [x] Verify Effect semantic drift risks, especially callbacks that must return
      their value rather than a boolean sentinel.
- [x] Run local runtime tests with coverage and inspect uncovered runtime
      branches.
- [x] Add focused regression tests or fixes for every confirmed bug.
- [x] Run the final relevant Deno checks/tests after fixes.

### Reverification Agents

- [x] Package/export agent.
- [x] Client/preprocess SvelteKit repro agent.
- [x] Remote/server SvelteKit repro agent.
- [x] Effect semantic drift and type behavior agent.

### Reverification Evidence

- Rebuilt runtime and packed
  `.tmp/ser-audit-2026-06-23/artifacts/svelte-effect-runtime-2.3.0.tgz`. Final
  pack: 102 files, 121344 bytes, integrity
  `sha512-oiJWCjvn3xOf5cgJC2ltwcpc/FdSsh4H0oE8T1wWVq0YBmu0A5vjsJ0qdY0QDjCYVwcbPgm4jKHU8cUngTvh6A==`.
- Subagent reports: `.tmp/ser-audit-2026-06-23/reports/package-exports.md`,
  `.tmp/ser-audit-2026-06-23/reports/client-preprocess.md`,
  `.tmp/ser-audit-2026-06-23/reports/remote-server.md`, and
  `.tmp/ser-audit-2026-06-23/reports/effect-types.md`.
- Fixed and covered confirmed bugs: direct `{@render yield* ...}` client build
  failure, empty successful `Response` decoding, SvelteKit form `data`
  envelopes, interrupt-only event/server causes, erased remote typed error
  channels, broad `Prerender` types, `value()` returning `unknown`,
  `FormInvalid.name` collisions, Standard Schema overload gaps, and form enhance
  submit boolean typing.
- Final local verification: `deno task check:runtime`,
  `deno task build:runtime`, and `deno task test:runtime` passed. Runtime tests:
  220 passed.
- Final coverage: branch 88.5%, function 86.1%, line 79.3%. Coverage artifacts
  are in `.tmp/ser-audit-2026-06-23/coverage-final/`.
- Fresh packed-tarball repro verification: remote-server repro `npm install`,
  `npm run check`, and `npm run build` passed; client-preprocess repro
  `npm install --legacy-peer-deps`, `npm run build`, `npm run test`, and
  `npm run test:e2e` passed.
- Remaining watch item: client-preprocess repro `npm run check` still fails
  because SvelteKit's check path parses raw `yield*` before SER preprocessing.
  Production build, Vitest, and Playwright e2e pass against the fresh tarball.

## Objective

Cover every practical way to use `svelte-effect-runtime` from a SvelteKit app
and exercise every runtime code branch we can reach through package exports,
preprocessing, generated code, remote helpers, dispatcher behavior, types, and
Effect semantics.

## Ground Rules

- Use the repository lockfile and Deno tasks.
- Build tarballs from this checkout and install those tarballs into repro apps.
- Keep throwaway repros outside source modules unless they become regression
  tests.
- Record evidence before fixing.
- Compare SER behavior against canonical Effect behavior where the runtime wraps
  or adapts Effect APIs.

## Coverage Matrix

- [x] Root package exports and client-safe/server-only behavior.
- [x] Published tarball contents and declaration files.
- [x] SvelteKit app install from local SER tarball.
- [x] Vite plugin import rewriting and preprocess registration.
- [x] `<script effect>` success, failure, interruption, dependencies, and SSR.
- [x] Markup `{yield* ...}` plain expression, event handler, each/await/render
      contexts, relocation maps, and invalid nested yield branches.
- [x] Dispatcher `fork`, `run`, `promise`, `value`, cleanup, cache, dependency
      hashing, fallback, failure, interruption, runtime injection, and reset
      paths.
- [x] Remote query, live query, command, form, prerender, redirect, error,
      request-event, schema, wrappers, and failure decoding paths.
- [x] Client remote adapters for value responses, `Response` responses, failed
      HTTP responses, serialized remote failures, validation failures, transport
      failures, pending state, descriptor copying, and form enhance callbacks.
- [x] Server runtime factories and control-flow helpers under real SvelteKit
      request handling.
- [x] Type behavior for public APIs, including remote helpers and callback
      return values.
- [x] Effect semantic drift checks: success values stay values, failures stay
      typed failures, defects are defects, interrupts are not normal failures,
      and callbacks preserve Effect-like return contracts.

## Workstreams

- [x] A. Package and export verification.
- [x] B. SvelteKit tarball repro for client/runtime/preprocess behavior.
- [x] C. Remote server/client repro for SvelteKit remote helpers.
- [x] D. Type-level and declaration audit.
- [x] E. Effect semantic drift audit.
- [x] F. Existing test branch coverage gap map.

## Findings

- Fixed: `Dispatcher.dispose()` interrupted active fibers and cleared internal
  maps but did not dispose the owned `ManagedRuntime`, so scoped layer
  finalizers were not released. Added a regression test and now calls
  `ManagedRuntime.dispose()` during dispatcher disposal.
- Fixed: local Deno runtime and test import maps used SvelteKit 2 / Vite 7 while
  the npm package peers require SvelteKit 3 next / Vite 8. Aligned both import
  maps with the published peer graph so local checks exercise the same API
  surface that tarball consumers install.
- Verified: `Effect.matchCause` event-handler rewriting upgrades to
  `Effect.matchCauseEffect` and preserves plain success callback values through
  `Effect.sync`, avoiding the previous boolean-return drift class.
- Verified: packed npm exports and generated declaration files resolve for all
  declared package subpaths.
- Watch item: `svelte-effect-runtime/server` resolves from npm but cannot be
  imported in plain Node because it depends on `$app/server`. Treat as
  intentional SvelteKit-only behavior or document/test it explicitly.
- Verified: server `Command` and `Form` helpers work through real SvelteKit
  remote endpoints in the Kit 3 tarball repro despite delegating to native
  SvelteKit helpers internally.
- Watch item: remote failure serialization focuses on typed `Fail` causes. Pure
  defects, interrupts, and composite cause structure are intentionally less rich
  today and deserve separate product semantics before changing.
- Fixed: direct `{@render yield* getSnippet()}` lowered to `(await promise)()`
  inside Svelte's generated non-async snippet callback, breaking client builds.
  It now lowers to the cached value helper with optional snippet invocation and
  has a client/server compiler regression.
- Fixed: successful empty `Response` values (`204`, `205`, or empty body) threw
  during `response.json()` instead of decoding as `undefined`.
- Fixed: SvelteKit 3 remote form success envelopes use `data`; SER only accepted
  `result`, producing `Unsupported remote form response`.
- Fixed: `Dispatcher.run(Effect.interrupt)` surfaced an uncaught error instead
  of treating interrupt-only exits as cancellation.
- Fixed: `run_remote_effect(Effect.interrupt)` encoded cancellation as a remote
  `Unknown error` envelope; interrupt-only causes now escape the remote failure
  encoder.
- Fixed: generated markup `value()` helper returned `unknown` instead of the
  yielded Effect success type.
- Fixed: public remote helper types erased typed error channels by exposing
  `RemoteFailure<unknown>` everywhere. Query, batch query, live query, Command,
  Form, and Prerender now preserve the handler's Effect error type.
- Fixed: `Prerender` was typed as `unknown` / broad native return shape instead
  of the SER Effect-returning remote function shape.
- Fixed: Standard Schema runtime support was not reflected in Query,
  Query.batch, Query.live, Command, Form, and Prerender overloads.
- Fixed: `FormInvalid.name` and other callable function-key field names collided
  with function properties instead of resolving to field invalid helpers.
- Fixed: form enhance `submit()` and `submit().updates()` types now preserve the
  boolean result returned by SvelteKit's submit flow.
- Verified: the prior `matchCauseEffect` success-callback boolean drift did not
  reproduce; success callbacks preserve returned values through the repro and
  regression tests.
- Watch item: SvelteKit's check path still reports raw `yield*` syntax before
  SER preprocessing. This affects `svelte-check`, while production build,
  Vitest, and Playwright e2e passed in the fresh client tarball repro.

## Evidence Log

- `deno task check:runtime` passed before fixes.
- `deno task test:runtime` passed with 201 tests before fixes.
- Added targeted `matchCauseEffect` value-preservation regression; it passed.
- Added targeted non-void remote form enhance callback type probes; they passed.
- Added targeted dispatcher finalizer regression; it failed before the fix and
  passed after calling `ManagedRuntime.dispose()`.
- Aligned runtime and test Deno import maps with the SvelteKit 3 next / Vite 8
  package peer graph. `deno task check:runtime` and `deno task test:runtime`
  both pass afterward.
- `deno task build:runtime` passed after the fixes and import-map alignment.
- `npm pack --json --dry-run ./modules/svelte-effect-runtime` passed with 102
  packed files.
- Package/export subagent verified `deno task build:runtime`, `npm pack`, temp
  consumer `import.meta.resolve`, temp consumer `tsc`, and
  `deno publish --dry-run --allow-dirty`.
- Client/preprocess tarball repro covered root `preprocess()`, Vite plugin,
  script effect success/failure, top-level await rejection, markup plain/event/
  each/await/render branches, invalid event callbacks, SSR output, hydration,
  and click event execution.
- Remote tarball repro covered Query, Query.batch, Query.live, Command, Form,
  Prerender, Error, Redirect, RequestEvent, ServerRuntime,
  `get_server_runtime_or_throw`, domain failure serialization, root server-only
  import behavior, and generated client wrappers.
- `deno task check:runtime` passed after the 2026-06-23 fixes.
- `deno task build:runtime` passed after the 2026-06-23 fixes.
- `deno task test:runtime` passed after the 2026-06-23 fixes with 220 tests.
- Focused changed-branch test run passed: 139 tests across markup,
  remote-client, dispatcher, remote-server, and remote-client-types.
- Final coverage run passed with 220 tests; all-files coverage was branch 88.5%,
  function 86.1%, line 79.3%.
- Final
  `npm pack --json --pack-destination
  .tmp/ser-audit-2026-06-23/artifacts ./modules/svelte-effect-runtime`
  passed with 102 packed files.
- Fresh remote-server SvelteKit repro using the final tarball passed
  `npm install`, `npm run check`, and `npm run build`.
- Fresh client/preprocess SvelteKit repro using the final tarball passed
  `npm install --legacy-peer-deps`, `npm run build`, `npm run test`, and
  `npm run test:e2e`.
