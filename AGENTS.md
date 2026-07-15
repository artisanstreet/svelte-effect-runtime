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

The SER documentation site and its documentation content live in the
`usebarekey/barekey` repository. Make documentation UI and content changes there,
not in this repository.

- **Source**: `modules/svelte-effect-runtime/src/`
- **Tests**: `.tests/svelte-effect-runtime/runtime/`
- **Build output**: `.dist/svelte-effect-runtime/`

Run tests: `corepack pnpm run test`

## JSDoc

Reserve full SDK-style JSDoc for public-facing exports that users import from a
published package entrypoint. An `export` used only between source modules, by
build tooling, by tests, or by an application bundle is not a public API.

Do not add `@example`, `@since`, `@param`, or `@returns` ceremony to internal
exports. Comment internal code only when it explains surprising behavior or a
constraint the code cannot make obvious, and keep that comment to a short
`/** */` sentence.

Public API JSDoc should have:

- A one-line **brief description** of what it does.
- `@since` annotation with the version it was introduced.
- `@param` for every parameter — not just the type, but a sentence explaining what the parameter represents and how it's used.
- `@returns` with the same level of detail.
- An `@example` only when realistic usage adds information beyond the signature
  and description.

```typescript
/**
 * Factory for Effect-backed read-only remote queries.
 *
 * @example
 * ```ts
 * export const GetUser = Query(
 *   Schema.Struct({ id: Schema.String }),
 *   ({ id }) => Effect.succeed({ id }),
 * );
 * ```
 *
 * @since 2.0.0
 */
export const Query: QueryFactory;
```

## Effect declarations

Effect-producing declarations use `PascalCase` and prefer inferred `const`
bindings. Let `Effect.gen` carry its own error and requirement types instead of
restating `Effect.Effect<...>` on every internal helper.

```typescript
export const MakeSerializedClientControl = (CreateClient: CreateClient) =>
  Effect.gen(function* () {
    const client = yield* CreateClient;

    return { client };
  });
```

Use a function declaration or explicit return annotation only when it provides a
real contract, such as a published API, overload, recursion, or a boundary that
must deliberately hide a more specific inferred type.

## CI / Publishing

Pull requests and pushes to `master` run fast staging verification only. They
never build release candidates, access publishing credentials, create tags, or
publish.

`candidate` is the protected production pointer. It may move only by fast-forward
to a commit already reachable from `master`. Candidate construction and
publication begin only through a manual `SER pipeline` dispatch with `candidate`
selected as the workflow ref.

The complete supported publication-channel set is npm, OpenVSX, and GitHub
Releases. Keep generic VSIX packaging because OpenVSX and GitHub Releases consume
it.

## Releasing

All packages must share the same semantic version. The four files that carry a version:

| File | Field |
|------|-------|
| `modules/svelte-effect-runtime/package.json` | `"version"` |
| `modules/svelte-effect-runtime-grammars/package.json` | `"version"` |
| `modules/svelte-effect-runtime-language-server/package.json` | `"version"` |
| `modules/svelte-effect-runtime-vsix/package.json` | `"version"` |

When releasing:

1. Determine the new version following [semantic versioning](https://semver.org):
   - **Major** (`2.0.0`): breaking API changes.
   - **Minor** (`1.7.0`): new features, backward-compatible.
   - **Patch** (`1.6.3`): bug fixes, no API or feature changes.
2. Bump all four files to the same version.
3. Merge the version change through a pull request to `master` and wait for
   `SER pipeline / Staging verified`.
4. After explicit human approval, fast-forward `candidate` to that exact verified
   commit. Do not add release-only commits to `candidate`.
5. Manually run `SER pipeline` on `candidate` in `dry-run` mode. After it verifies
   the exact packages and browser smoke, run `release` mode for the same commit.

If publication fails after durable provider state exists, leave `candidate`
unchanged and dispatch `resume` with the failed run's exact version, full commit
SHA, and run ID. Resume restores and revalidates that run's candidate bundle; it
must not rebuild or repack. See `RELEASING.md` for the complete procedure.
