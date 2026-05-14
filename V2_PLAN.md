# V2 Plan — Svelte Effect Runtime

## Status

**Current**: Preprocessor ✅ | Detection ✅ | Dispatcher stubs | Markup transform ❌ | Runtime ❌ | Vite plugin ❌

## Architecture

A unified **dispatcher** manages the fiber lifecycle of every effect block. The
preprocessor only detects and wraps — it never deeply analyzes user code.

```
Source → Detection → Extraction → Code Generation → Dispatcher
                                                      │
                                            ┌─────────┴─────────┐
                                            ▼                   ▼
                                       fork()               value()
                                       run()                promise()
```

## What's done

| Component | File | Status |
|-----------|------|--------|
| yield* detection | `src/detect.ts` | ✅ 17 tests |
| Dispatcher class | `src/dispatcher.ts` | ⚠️ stub — `fork`, `value`, `promise`, `run` all return placeholders |
| Script preprocessor | `src/preprocess.ts` | ✅ 22 tests — `transform_script_effect` handles all lowering patterns |
| Markup preprocessor | `src/preprocess.ts` | ❌ `transform_markup_effect` throws "not implemented" |
| Generators barrel | `src/generators.ts` | ✅ exports `get_dispatcher` only |
| Lowering helper | `src/lowering.ts` | ⚠️ `extract_yield_stars` throws "not implemented" (not currently used) |
| Error classes | `src/error.ts` | ✅ `TopLevelAwaitError`, `YieldStarInRuneError`, `PreprocessError` |
| Public API barrel | `src/mod.ts` | ✅ |
| Vite plugin | `src/vite.ts` | ❌ not created |
| Server runtime | `src/server.ts` | ❌ not created |
| Markup helpers | `src/markup/` | ❌ not created |
| Remote adapters | `src/remote/` | ❌ not created |

## Generated code conventions

All as-designed and implemented:

| Convention | Example |
|-----------|---------|
| Generated temp bindings | `__SER__user`, `__SER__post`, `__SER__0` |
| Generated program | `__SER__program` |
| Generator imports | `import { get_dispatcher } from "svelte-effect-runtime/generators"` |
| `onMount` import | emitted directly: `import { onMount } from "svelte"` — NOT re-exported |
| `Effect` import | emitted directly: `import { Effect } from "effect"` — peer dep, NOT re-exported |

## Preprocessor — verified lowering patterns

All verified by 22 tests in `preprocess.test.ts`:

```
$state(yield* expr)       ✅  temp + preserved $state() wrapper
const x = yield* expr     ✅  becomes let x = $state(temp)
const {a,b} = yield*      ✅  destructuring with individual $state per name
$derived(yield* x + 1)    ✅  $derived() preserved, yield* swapped
$state.raw(yield* expr)   ✅  .raw preserved
$inspect(yield* expr)     ✅  call expression lowered
count = yield* expr       ✅  assignment expression extracted
yield* logView(id)        ✅  bare yield* moved to effect body
yield* inside () =>       ✅  NOT lowered (function boundary)
yield* in Effect.gen       ✅  NOT lowered (nested generator)
await top-level            ✅  rejected with TopLevelAwaitError
No yield* at all           ✅  identity pass-through
```

## What's next

### Phase 1 — finish the runtime (highest priority)

1. **Implement `Dispatcher.fork()`** — actually run effects via `ManagedRuntime`, manage fiber lifecycle, wire up cleanup
2. **Implement `Dispatcher.value()`** — cache results by `id::depsHash`, return fallback before resolved, wire into `$state`
3. **Implement `Dispatcher.promise()`** — return a promise that resolves when the effect completes
4. **Implement `Dispatcher.run()`** — fire-and-forget for event handlers
5. **Add runtime tests** — verify fibers start, complete, cancel, and fail correctly

### Phase 2 — finish the preprocessor

6. **Implement `transform_markup_effect()`** — detect `{yield* expr}` in template braces, emit `value()`/`promise()`/`run()` calls
7. **Create `src/markup/value.ts`** — runtime helper for value expressions in markup
8. **Create `src/markup/promise.ts`** — runtime helper for `{#await}` blocks
9. **Create `src/markup/run.ts`** — runtime helper for event handlers

### Phase 3 — server & tooling

10. **Create `src/server.ts`** — ServerRuntime, Query, Command, Form, Prerender (Effect v4 only)
11. **Create `src/vite.ts`** — Vite plugin for SvelteKit remote function integration
12. **Create `src/remote/shared.ts`** — RemoteFailure, FormError, serialization types
13. **Create `src/remote/server.ts`** — server-side remote handlers
14. **Create `src/remote/client.ts`** — client-side remote adapters

### Phase 4 — polish

15. Remove stubs from `dispatcher.ts` — delete `reset_dispatcher()` or implement it properly
16. Implement `src/lowering.ts` — `extract_yield_stars()` or remove it
17. Integration test: full pipeline from `.svelte` file → preprocessor → dispatcher → mounted component

## What the preprocessor does NOT do (by design, not by omission)

| Not done | Why |
|----------|-----|
| Scope tracking of effect-bound bindings | User writes `$derived(format(user))` themselves |
| Statement classification (hoisted vs lowered) | Single rule: does it contain top-level `yield*`? |
| Helper thunk extraction | No longer needed — variables are `$state` signals |
| `onMount` re-export from generators | Emitted directly from `"svelte"` |
| `Effect` re-export from generators | Emitted directly from `"effect"` — it's a peer dep |
| v3/v4/effect-compat compat layers | Deleted — Effect v4 only |

## File structure

```
src/
├── mod.ts           ✅ Public API
├── detect.ts        ✅ yield* detection
├── dispatcher.ts    ⚠️ Dispatcher (stubs)
├── preprocess.ts    ⚠️ script ✅, markup ❌
├── generators.ts    ✅ preprocessor imports
├── lowering.ts      ⚠️ stub
├── error.ts         ✅ error classes
├── server.ts        ❌ not yet
├── vite.ts          ❌ not yet
├── markup/          ❌ not yet
│   ├── value.ts
│   ├── promise.ts
│   └── run.ts
├── remote/          ❌ not yet
│   ├── server.ts
│   ├── client.ts
│   └── shared.ts
```
