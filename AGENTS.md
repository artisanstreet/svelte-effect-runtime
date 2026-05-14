# AGENTS.md

## Style

- **Function, variable, method names**: `snake_case`
- **Classes, types, interfaces, components**: `PascalCase`
- **File names**: `kebab-case.ts`
- **Directories**: group related files by directory, not by filename prefix (e.g. `internal/transform.ts` not `internal-transform.ts`)

## V2 Focus

The `v2` branch focuses exclusively on the runtime module (`modules/svelte-effect-runtime`). The language server (`modules/svelte-effect-runtime-language-server`) and VS Code extension (`modules/svelte-effect-runtime-vscode-extension`) modules are not being actively developed during V2. All new code, tests, and CI work targets only the runtime package.

- **Source**: `modules/svelte-effect-runtime/src/v2/`
- **Tests**: `.tests/svelte-effect-runtime/v2/`
- **Build output**: `.dist/svelte-effect-runtime/`

Run tests: `cd .tests/svelte-effect-runtime && deno test --no-check -A v2/`

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

All packages must share the same semantic version. The four files that carry a version:

| File | Field |
|------|-------|
| `modules/svelte-effect-runtime/package.json` | `"version"` |
| `modules/svelte-effect-runtime/deno.json` | `"version"` |
| `modules/svelte-effect-runtime-language-server/package.json` | `"version"` |
| `modules/svelte-effect-runtime-vscode-extension/package.json` | `"version"` |

When releasing:

1. Determine the new version following [semantic versioning](https://semver.org):
   - **Major** (`2.0.0`): breaking API changes.
   - **Minor** (`1.7.0`): new features, backward-compatible.
   - **Patch** (`1.6.3`): bug fixes, no API or feature changes.
2. Bump all four files to the same version.
3. Commit and push to `master`.

The CI will detect the version bump, run the full test suite, build all packages, and publish. If the versions are out of sync at any point, the release job will fail.
