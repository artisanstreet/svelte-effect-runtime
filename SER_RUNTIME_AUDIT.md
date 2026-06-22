# SER Runtime Audit

Date: 2026-06-22

## Objective

Cover every practical way to use `svelte-effect-runtime` from a SvelteKit app and
exercise every runtime code branch we can reach through package exports,
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
  hashing, fallback, failure, interruption, runtime injection, and reset paths.
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
  typed failures, defects are defects, interrupts are not normal failures, and
  callbacks preserve Effect-like return contracts.

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
- Fixed: local Deno runtime and test import maps used SvelteKit 2 / Vite 7
  while the npm package peers require SvelteKit 3 next / Vite 8. Aligned both
  import maps with the published peer graph so local checks exercise the same
  API surface that tarball consumers install.
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
- Watch item: remote failure serialization focuses on typed `Fail` causes.
  Pure defects, interrupts, and composite cause structure are intentionally
  less rich today and deserve separate product semantics before changing.

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
- Package/export subagent verified `deno task build:runtime`, `npm pack`,
  temp consumer `import.meta.resolve`, temp consumer `tsc`, and
  `deno publish --dry-run --allow-dirty`.
- Client/preprocess tarball repro covered root `preprocess()`, Vite plugin,
  script effect success/failure, top-level await rejection, markup plain/event/
  each/await/render branches, invalid event callbacks, SSR output, hydration,
  and click event execution.
- Remote tarball repro covered Query, Query.batch, Query.live, Command, Form,
  Prerender, Error, Redirect, RequestEvent, ServerRuntime,
  `get_server_runtime_or_throw`, domain failure serialization, root server-only
  import behavior, and generated client wrappers.
