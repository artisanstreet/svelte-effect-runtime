# V2 Plan — Svelte Effect Runtime

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

## Generated code conventions

| Convention | Example |
|-----------|---------|
| User-visible functions from `generators` | `onMount`, `Effect`, `get_dispatcher`, `value`, `promise`, `run` — clean names, no prefix |
| Generated temp bindings | `__SER__user`, `__SER__post`, `__SER__0` — `__SER__` prefix + original variable name or index |
| Generated program | `__SER__program` |
| Generator imports | `import { get_dispatcher } from "svelte-effect-runtime/generators"` |
| Effect import | `import { Effect } from "effect"` — Effect is a peer dependency, never re-exported by SER |

Generated temp names derive from the original binding name where possible:

- `const user = yield* getUser(id)` → `__SER__user`
- `const post = await getPost(id)` → `__SER__post`
- `const { a, b } = yield* getPair()` → `__SER__pair` (destructuring temp)
- `yield* logView(id)` → `__SER__0` (bare statement, no binding name)

## Preprocessor detection rules

The preprocessor asks one question: does a top-level expression contain `yield*`
outside any function boundary?

### Patterns that are lowered

```svelte
<script lang="ts" effect>
  // ─── All of these trigger lowering ───

  let user = $state(yield* getUser(id));

  let count = $state(0);
  count = yield* getCount();

  const post = yield* getPost(id);

  const { title, body } = yield* getPost(id);

  let msg = $derived(yield* format(user) + "!");

  let stats = $derived.by(() => yield* computeStats(user));

  let raw = $state.raw(yield* getRaw(id));

  $inspect(yield* debugInfo());

  yield* logView(user.id);

  // ─── NOT lowered (no top-level yield*) ───

  $effect(() => { yield* doThing(); });  // yield* inside () => function boundary
  const name = formatName(user);         // no yield*
  let x = $state(42);                    // no yield*
  import { foo } from "./bar";           // not an expression
</script>
```

### Lowering rules

For each expression containing `yield*`:

1. Extract the `yield* expr` sub-expression into a temp `$state` binding
2. Replace the `yield* expr` span in the original expression with the temp ref
3. Emit the assignment `__SER__name = yield* expr` in the effect body

The surrounding expression (whether `$state(...)`, `$derived(...)`, `$state.raw(...)`, a plain `const`, etc.) is preserved character-for-character — only the `yield*` span is swapped.

## Generated output examples

### Input

```svelte
<script lang="ts" effect>
  import { getUser, getPost } from "./api";

  let user = $state(yield* getUser(id));

  let count = $state(0);
  count = yield* getCount();

  const { title, body } = yield* getPost(user.id);

  yield* logView(user.id);

  let message = $derived(yield* format(user) + "!");

  let display = $state("loading...");

  $effect(() => {
    document.title = `${user.name} - ${title}`;
  });
</script>

<h1>{display}</h1>
<p>{title} by {user.name}</p>
<small>{yield* renderDate()}</small>
```

### Generated script

```js
import { onMount } from "svelte";
import { Effect } from "effect";
import { get_dispatcher } from "svelte-effect-runtime/generators";
import { getUser, getPost } from "./api";

let __SER__user = $state(undefined);
let __SER__count = $state(undefined);
let __SER__post = $state(undefined);
let __SER__0 = $state(undefined);
let __SER__msg = $state(undefined);

let user = $state(__SER__user);

let count = $state(0);
count = __SER__count;

let title = $state(undefined);
let body = $state(undefined);

let message = $derived(__SER__msg + "!");

let display = $state("loading...");

$effect(() => {
  document.title = `${user.name} - ${title}`;
});

const __SER__program = Effect.gen(function* () {
  __SER__user = yield* getUser(id);
  __SER__count = yield* getCount();
  __SER__post = yield* getPost(user.id);
  ({ title, body } = __SER__post);
  yield* logView(user.id);
  __SER__msg = yield* format(user);
});

onMount(() => {
  const dispatcher = get_dispatcher();
  const cleanup = dispatcher.fork(__SER__program);
  import.meta.hot?.dispose(cleanup);
  return cleanup;
});
```

### Generated markup

```html
<h1>{display}</h1>
<p>{title} by {user.name}</p>
<small>{value({ id: "m-0", deps: [], fallback: undefined, factory: function* () { return (yield* renderDate()); } })}</small>
```

Markup helpers (`value`, `promise`, `run`) are also imported from `"svelte-effect-runtime/generators"` and injected into the instance `<script>` tag.

## Runtime API

### `svelte-effect-runtime/generators` (imported by generated code)

```typescript
// Re-exports for preprocessor-generated code only
// These are NOT public API — users don't import this module directly

export { onMount } from "svelte";
export { get_dispatcher } from "./dispatcher";
export { value } from "./markup/value";
export { promise } from "./markup/promise";
export { run } from "./markup/run";
```

Note: `Effect` is NOT re-exported. The preprocessor emits `import { Effect } from "effect"` directly. Effect is a peerDependency of SER.

### `Dispatcher` (public API)

```typescript
class Dispatcher {
  fork<R, E, A>(effect: Effect<R, E, A>): () => void;
  value<R, E, A>(opts: ValueOptions<R, E, A>): A;
  promise<R, E, A>(opts: PromiseOptions<R, E, A>): Promise<A>;
  run<R, E, A>(effect: Effect<R, E, A>): Promise<A>;
  dispose(): void;
}
```

## What the preprocessor does NOT do

| Not done | Why |
|----------|-----|
| Scope tracking of effect-bound bindings | User writes `$derived(format(user))` themselves |
| Statement classification (hoisted vs lowered) | Single rule: does it contain top-level `yield*`? |
| Helper thunk extraction (`__helper_N = () => expr`) | No longer needed — variables are `$state` signals that re-render |
| `__Yielded<T>` type inference | Types come from explicit annotations or inference, not SER |
| Source relocation mapping | V2 minimizes code movement; if needed, use offset tracking not string search |
| Rune enumeration (`$effect`, `$derived`, etc.) | No special handling — they pass through unless they contain top-level `yield*` |

## V2 file structure

```
v2/
├── mod.ts                  # Public API: Dispatcher.make(), ClientDispatcher, etc.
├── dispatcher.ts           # The core Dispatcher class
├── generators.ts           # Barrel for preprocessor-generated imports
├── preprocess.ts           # Svelte preprocessor (script + markup hooks)
├── detect.ts               # yield* detection (containsTopLevelYieldStar, etc.)
├── lowering.ts             # Expression lowering (extract yield*, replace with temp)
├── vite.ts                 # Vite plugin
├── markup/
│   ├── value.ts            # value() helper for {yield* expr} in markup
│   ├── promise.ts          # promise() helper for {#await}
│   └── run.ts              # run() helper for event handlers
├── remote/
│   ├── server.ts           # Query, Command, Form, Prerender (server-side)
│   ├── client.ts           # Client-side remote adapters
│   └── shared.ts           # Shared remote types (keep from v3)
└── error.ts                # Unified error handling
```
