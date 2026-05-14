# V2 Plan — Svelte Effect Runtime

## Status

**Current**: P1 ✅ | P2 ✅ | P3 ❌ | P4 ❌

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
| Dispatcher class | `src/dispatcher.ts` | ✅ 24 tests — real fiber lifecycle with cancel/retry/dispose |
| Script preprocessor | `src/preprocess.ts` | ✅ 22 tests — all lowering patterns |
| Markup preprocessor | `src/markup/transform.ts` | ✅ 20 tests — sanitize-before-parse approach |
| Markup helpers | `src/markup/{value,promise,run}.ts` | ✅ |
| Lowering helper | `src/lowering.ts` | ⚠️ unused stub |
| Error classes | `src/error.ts` | ✅ |
| Public API barrel | `src/mod.ts` | ✅ |
| Vite plugin | `src/vite.ts` | ❌ Phase 3 |
| Server runtime | `src/server.ts` | ❌ Phase 3 |
| Markup helpers | `src/markup/` | ⚠️ Phase 2 |
| Remote adapters | `src/remote/` | ❌ Phase 3 |

**Test suite**: 86 tests, 0 failures, ~2s

---

## Phase 2 — Markup Transform

### What needs to be built

1. **`src/markup/value.ts`** — runtime helper for `{yield* expr}` in markup
2. **`src/markup/promise.ts`** — runtime helper for `{#await yield* expr}`
3. **`src/markup/run.ts`** — runtime helper for inline event handlers
4. **`transform_markup_effect()`** — the markup preprocessor that detects `{yield* expr}` and rewrites to helper calls
5. **Tests** for all of the above

### Design — `transform_markup_effect()`

The markup preprocessor operates on a full `.svelte` file string. It must:

1. **Fast-path**: If the file contains no `yield*` text at all (`/\byield\s*\*/.test(content)`), return the content unchanged.
2. **Find brace expressions**: Walk Svelte's AST (using `svelte/compiler`) to find `ExpressionTag` nodes.
3. **Classify context**: For each tag containing `yield*`, determine whether it's a plain expression, an `{#await}`, `{#each}`, `{#if}`, event handler, or `{@render}`.
4. **Replace**: Swap the expression with the appropriate helper call:
   - Plain `{yield* expr}` → `{value({ id, deps, fallback, factory })}`
   - `{#await yield* promise}` → `{#await promise({ id, deps, factory })}`
   - Event handler → wrapped with `run()` inside the handler
   - `{@render yield* fn()}` → `{(value({ ... }))()}` (Svelte snippet convention)
5. **Inject imports**: Add `import { value, promise, run } from "svelte-effect-runtime/generators"` into the instance `<script>` tag (the non-context, non-module script tag).

### Key simplification vs V1

| V1 approach | P2 approach |
|------------|-------------|
| Custom character-by-character brace parser (148-line `findClosingBrace`) | Use Svelte's own AST for expression boundaries |
| Babel-based yield* detection using parser failure semantics | Use our own `contains_top_level_yield_star` (already built) |
| Complex helper code injection (100+ line template) | Simple import injection into existing `<script>` tag |
| Free identifier analysis for deps | Simple identifiers only — same as script preprocessor |

### Free identifier detection

For `value()` calls, we need to detect which identifiers in the expression are "free" (not declared locally). This lets Svelte track reactive dependencies. Example:

```
{user.name} → deps: ["user"]       (both are free identifiers)
{format(user)} → deps: ["format", "user"]  
```

We walk the TS AST of the expression, skip function boundaries and locally-declared bindings (e.g., `{#each items as item}` declares `item`), and collect the remaining identifiers.

### `value()` helper API

```typescript
/**
 * Runtime helper for `{yield* expr}` markup expressions.
 * Calls `get_dispatcher().value()`.
 */
function value(
  id: string,
  deps: unknown[],
  fallback: unknown,
  factory: () => Generator<unknown, unknown, unknown>,
): unknown {
  return get_dispatcher().value({ id, deps, fallback, factory });
}
```

### `promise()` helper API

```typescript
function promise(
  id: string,
  deps: unknown[],
  factory: () => Generator<unknown, unknown, unknown>,
): Promise<unknown> {
  return get_dispatcher().promise({ id, deps, factory });
}
```

### `run()` helper API

```typescript
function run(
  factory: () => Generator<unknown, unknown, unknown>,
): Promise<unknown> {
  return get_dispatcher().run(Effect.gen(factory));
}
```

### Tests for Phase 2

**markup preprocessor tests** (`markup.test.ts`):
- Identity pass-through for files with no `yield*`
- `{yield* expr}` → `value(...)` call
- `{#if yield* expr}` → `value(...)` in condition
- `{#each yield* expr as item}` → `value(...)` in list expression
- `{#await yield* promise}` → `promise(...)` call
- `{@render yield* fn()}` → `(value(...))()` IIFE
- Event handler `on:click={() => yield* fn()}` → `run()` wrapper
- `{@const x = yield* expr}` → `value(...)` in const initializer
- Multiple yield* in markup → all replaced
- Free identifier collection (correct deps array)
- Script tag injection for import
- No script tag → creates one with imports
- Module context script is skipped
- Idempotency (double-preprocess)

**markup helper tests** (`markup.test.ts`):
- `value()` returns fallback synchronously
- `value()` returns resolved value after completion
- `value()` caches by id + deps
- `promise()` returns Promise
- `promise()` resolves with effect result
- `run()` fires and forgets

---

## Phase 3 — Server + Vite + Remote

10. Create `src/server.ts` — ServerRuntime, Query, Command, Form, Prerender (Effect v4 only)
11. Create `src/vite.ts` — Vite plugin for SvelteKit
12. Create `src/remote/shared.ts` — RemoteFailure, FormError
13. Create `src/remote/server.ts` — server-side remote handlers
14. Create `src/remote/client.ts` — client-side remote adapters

## Phase 4 — Polish

15. Remove `lowering.ts` stub or implement it
16. Add `Dispatcher.make()` factory
17. Integration test: full pipeline
18. Remove `reset_dispatcher()` after integration tests no longer need it

## File structure

```
src/
├── mod.ts           ✅
├── detect.ts        ✅
├── dispatcher.ts    ✅
├── preprocess.ts    ✅
├── generators.ts    ✅
├── lowering.ts      ⚠️ unused stub
├── error.ts         ✅
├── server.ts        ❌ P3
├── vite.ts          ❌ P3
├── markup/          ✅
│   ├── transform.ts
│   ├── value.ts
│   ├── promise.ts
│   └── run.ts
├── remote/          ❌ P3
│   ├── server.ts
│   ├── client.ts
│   └── shared.ts
```
