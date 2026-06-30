# AGENTS.md

## Style

- **Function, variable, method names**: `snake_case`
- **Classes, types, interfaces, components**: `PascalCase`
- **File names**: `kebab-case.ts`
- **Directories**: group related files by directory, not by filename prefix (e.g. `internal/transform.ts` not `internal-transform.ts`)

## Git

Have good git etiquette. For each successful change, create a commit and push it
to the relevant remote branch.

- Never push to `master` without explicit human approval.
- Always create a branch named for the work you are doing before making changes.
- When follow-up work grows beyond the branch's original purpose, create a new
  branch from the current branch instead of piling unrelated work onto one broad
  branch.
- Keep commit messages brief and easy to read, using conventional prefixes such
  as `docs: fix typo in get started page` or `fix: preserve tagged remote
  failures`.
- Do not include AI model names, provider names, or agent identifiers in commit
  messages unless a human explicitly asks for them.

### Spacing

Every function gives its logic room to breathe. No dense walls of code.

- **Variables grouped at the top** of a function, followed by a blank line before the logic begins.
- **Logical phases** separated by a blank line and a `/** */` doc comment summarising what the phase does.
- **Guard clauses** early and concise — return or continue fast so the happy path stays indented cleanly.
- **if/else branches** get a blank line between them when they contain more than a single return.
- **Return statements** always have a blank line above them unless preceded by only a single guard clause.
- **No inline returns** for multi-step logic — split across lines.

```typescript
/** Correct — phases separated, returns breathe. */

export function transform_script_effect(
  content: string,
  filename: string,
): ScriptTransformResult {

  const source_file = ts.createSourceFile(/* ... */);
  const magic = new MagicString(content);

  const has_effect_import = source_file.statements.some(/* ... */);

  /**
   * Phase 2 — lower every statement containing top-level `yield*`.
   */
  for (const stmt of source_file.statements) {

    if (contains_top_level_await(stmt)) {
      throw new Error("await is not supported");
    }

    if (!contains_top_level_yield_star(stmt)) {
      continue;
    }

    const lowered = lower_statement(stmt, content);
    magic.overwrite(lowered.range.start, lowered.range.end, lowered.rewritten_text);
  }

  /**
   * Phase 3 — inject imports.
   */
  const imports = make_imports(has_effect_import);

  const last_import = [...source_file.statements]
    .reverse()
    .find(ts.isImportDeclaration);

  if (last_import) {
    magic.appendRight(last_import.end, "\n" + imports);
  } else {
    magic.prepend(imports + "\n");
  }

  return { code: magic.toString(), blocks: [] };
}
```

### Syntax

Favor modern, intentful operators over imperative ceremony.

| Use | Instead of |
|-----|------------|
| `x ?? default` / `x ??= default` | `if (x === null \|\| x === undefined) x = default` |
| `.some(predicate)` | manual `for` loop setting a boolean flag |
| `.find(predicate)` | manual `for` loop with `break` |
| `.filter(Boolean).join()` | `.push()` in a conditional loop |
| `.map(fn)` / `for...of` | `for(let i=0; i<arr.length; i++)` |
| ternary (for compact returns) | `if/else` assigning the same variable |
| `?.` optional chaining | nested `if (x && x.y)` checks |
| `[...arr, item]` spread | `arr.push(item)` when building a new array |

```typescript
/** Correct — declarative operators showing intent. */

const has_effect_import = source_file.statements.some(
  (stmt) =>
    ts.isImportDeclaration(stmt) &&
    ts.isStringLiteral(stmt.moduleSpecifier) &&
    stmt.moduleSpecifier.text === "effect",
);

const last_import = [...source_file.statements]
  .reverse()
  .find(ts.isImportDeclaration);

function get_dispatcher(): Dispatcher {
  current_dispatcher ??= new Dispatcher();
  return current_dispatcher;
}

function make_imports(has_effect_import: boolean): string {
  return [
    `import { onMount } from "svelte";`,
    !has_effect_import && `import { Effect } from "effect";`,
    `import { get_dispatcher } from "svelte-effect-runtime/generators";`,
  ].filter(Boolean).join("\n");
}
```

### Comments

All comments use `/** */` JSDoc style. No bare `//` or `/* */` comments anywhere.

```typescript
/** Correct */
/** Registry of active cleanup handles. */
#cleanups = new Set<Dispose>();
```

```typescript
/** Wrong — bare comment */
// Registry of active cleanup handles
#cleanups = new Set<Dispose>();
```

### Imports

Imports are grouped and sorted by line length descending:

1. **Named imports** (`{ ... }`) come first.
2. **Default imports** come next.
3. **Namespace imports** (`* as`) come last.

    | `Effect.Effect<A, E, R>` | `Effect` |
    | `_tag` / `issue` / `throw`    | `_tag` / `issue` / `throw`    |

Within each group, longer lines sort above shorter lines. A blank line
separates each group.

```typescript
/** Correct — groups separated, sorted by length descending. */

import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";
import { type AST, parse } from "svelte/compiler";
import type { Plugin } from "vite";
import { stringify } from "devalue";

import MagicString from "magic-string";
import ts from "typescript";
```

```typescript
/** Wrong — unsorted, mixed groups. */

import MagicString from "magic-string";
import { Cause, Effect } from "effect";
import ts from "typescript";
import type { Plugin } from "vite";
```

## Project Focus

The runtime module is the primary implementation target. Language server and VS
Code extension changes should be made when runtime syntax or generated code
needs editor support.

- **Source**: `modules/svelte-effect-runtime/src/`
- **Tests**: `.tests/svelte-effect-runtime/runtime/`
- **Build output**: `.dist/svelte-effect-runtime/`

Run tests: `cd .tests/svelte-effect-runtime && deno test --no-check -A runtime/`

## JSDoc

Every exported function, class, and type must have a JSDoc block with:

- A one-line **brief description** of what it does.
- An `@example` block showing realistic usage.
- `@since` annotation with the version it was introduced.
- `@param` for every parameter — not just the type, but a sentence explaining what the parameter represents and how it's used.
- `@returns` with the same level of detail.

```typescript
/**
 * Runs an effect block as a forked fiber and wires its result into a reactive
 * `$state` binding. The fiber is automatically cancelled when the component
 * unmounts.
 *
 * @example
 * ```ts
 * const user = dispatcher.value({
 *   id: "load-user",
 *   deps: [userId],
 *   fallback: placeholder,
 *   block: () => getUser(userId),
 * });
 * ```
 *
 * @since 2.0.0
 * @param id - Stable identifier for this value block, used for cache lookups
 *   and HMR survival.
 * @param deps - Array of reactive dependencies. When any dep changes, the
 *   previous fiber is cancelled and a new one starts.
 * @param fallback - Value returned synchronously while the effect is running
 *   or when running on the server (SSR).
 * @param block - The effect to execute. Called once per unique `(id, deps)`
 *   combination; the result is cached and subscribed.
 * @returns The current value — the fallback initially, then the resolved
 *   effect value once the fiber completes.
 */
function value<A>(options: ValueOptions<A>): A;
```

## CI / Publishing

When a commit is pushed to `master`:

- If any `package.json` version field changed, the CI workflow automatically builds, lints, tests, and publishes.
- The release workflow creates a git tag, a GitHub release, and publishes to npm, JSR, and the VS Code marketplace.
- **Be careful with version bumps** — a push to `master` that changes a version number will trigger a full release.

## Releasing

All packages must share the same semantic version. The six files that carry a version:

| File | Field |
|------|-------|
| `modules/svelte-effect-runtime/package.json` | `"version"` |
| `modules/svelte-effect-runtime/deno.json` | `"version"` |
| `modules/svelte-effect-runtime-grammars/package.json` | `"version"` |
| `modules/svelte-effect-runtime-grammars/deno.json` | `"version"` |
| `modules/svelte-effect-runtime-language-server/package.json` | `"version"` |
| `modules/svelte-effect-runtime-vsix/package.json` | `"version"` |

When releasing:

1. Determine the new version following [semantic versioning](https://semver.org):
   - **Major** (`2.0.0`): breaking API changes.
   - **Minor** (`1.7.0`): new features, backward-compatible.
   - **Patch** (`1.6.3`): bug fixes, no API or feature changes.
2. Bump all six files to the same version.
3. After explicit human approval, commit and push to `master`.

The CI will detect the version bump, run the full test suite, build all packages, and publish. If the versions are out of sync at any point, the release job will fail.
