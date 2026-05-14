# V2 Plan — Svelte Effect Runtime

## Status

**Current**: P1 ✅ | P2 ✅ | P3 ✅ | P4 ❌

**Effect dependency**: `npm:effect@beta` (4.0.0-beta.66)

## Architecture

```
Source → Detection → Extraction → Code Generation → Dispatcher
                                                      │
                                            ┌─────────┴─────────┐
                                            ▼                   ▼
                                       fork()               value()
                                       run()                promise()

Server-side:
  .remote.ts → server.ts → run_remote_effect() → ManagedRuntime
                          Query / Command / Form / Prerender

Client-side:
  vite.ts → generates __sveltekit/remote → remote/client.ts
          → query/command/form adapters → Effect.promise
```

## What's done

| Component | File | Status |
|-----------|------|--------|
| yield* detection | `src/detect.ts` | ✅ 17 tests |
| Dispatcher class | `src/dispatcher.ts` | ✅ 24 tests |
| Script preprocessor | `src/preprocess.ts` | ✅ 22 tests |
| Markup preprocessor | `src/markup/transform.ts` | ✅ 24 tests |
| Markup helpers | `src/markup/{value,promise,run}.ts` | ✅ |
| Error classes | `src/error.ts` | ✅ |
| Public API barrel | `src/mod.ts` | ✅ |
| Generators barrel | `src/generators.ts` | ✅ 3 tests |
| Remote error types | `src/remote/shared.ts` | ✅ 18 tests |
| Server handler utils | `src/remote/server.ts` | ✅ 9 tests |
| Client adapters | `src/remote/client.ts` | ✅ |
| Server runtime | `src/server.ts` | ✅ |
| Vite plugin | `src/vite.ts` | ✅ |
| Lowering helper | `src/lowering.ts` | ⚠️ unused stub |

**Test suite**: 117 tests, 0 failures, ~1s

## File structure

```
src/
├── mod.ts
├── detect.ts
├── dispatcher.ts
├── preprocess.ts
├── generators.ts
├── lowering.ts          (stub)
├── error.ts
├── server.ts
├── vite.ts
├── markup/
│   ├── transform.ts
│   ├── value.ts
│   ├── promise.ts
│   └── run.ts
└── remote/
    ├── shared.ts
    ├── server.ts
    └── client.ts
```

## Effect v4 migration

Upgraded from `effect@^3.21.0` to `effect@4.0.0-beta.66`. Key API changes:

| Old (v3) | New (v4 beta) |
|----------|---------------|
| `Cause.isInterruptedOnly(c)` | `Cause.hasInterruptsOnly(c)` |
| `fiber.await` (property) | `Fiber.await(fiber)` (module fn) |
| `Cause.failures(cause)` | `cause.reasons` + `Cause.isFailReason(r)` |
| `Effect.async(resume => {})` | `Effect.promise(async () => {})` |
| `Context.GenericTag<T>(k)` | `Context.Reference<T>(k)` |
| `Context.provide(e, tag, svc)` | `Effect.provideService(e, tag, svc)` |

Notable behavioral change: `ManagedRuntime.runFork` runs synchronously for
resolved effects in v4 (e.g. `Effect.succeed(42)` completes before `runFork()`
returns). This is actually better — the fallback remains a safety net for
truly async effects.

## Phase 4 — Polish

- Remove `lowering.ts` stub or implement it
- Add `Dispatcher.make()` factory
- Integration test: full pipeline
- Remove `reset_dispatcher()` after no longer needed
