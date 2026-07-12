# Contributing

Thanks for working on Svelte Effect Runtime. This repo is a small workspace with
several publishable packages, so the main rule is to keep changes scoped and run
the checks that match the package you touched.

## Setup

Use pnpm through Corepack. The repo is pinned to `pnpm@11.10.0` and requires
Node `^22.12.0 || >=24.0.0`.

```bash
corepack enable
corepack pnpm install
```

The build and validation scripts use Vite+. If `vp` is missing, install the
standalone Vite+ binary from <https://vite.plus>.

## Repo Layout

- `modules/svelte-effect-runtime` is the runtime, compiler plugin, server
  helpers, remote helpers, dispatcher, and generated transforms.
- `modules/svelte-effect-runtime-grammars` owns TextMate and tree-sitter grammar
  assets used by SER-aware tooling.
- `modules/svelte-effect-runtime-language-server` packages the language server
  integration used by editor tooling.
- `modules/svelte-effect-runtime-vsix` packages the VS Code extension that
  installs and launches the language server.
- `.tests` contains the Vitest suites for runtime, grammars, language server,
  and VSIX behavior.
- `build` contains workspace build, packaging, asset, and cleanup scripts.
- `skills/svelte-effect-runtime` contains the Codex skill shipped with the repo.

SER documentation content and documentation UI live in
`usebarekey/barekey/modules/frontend/src/content`, not in this repo. If a PR
changes SER behavior, public API shape, syntax, setup, or user-facing runtime
semantics, update the Barekey docs in the same line of work.

## Common Commands

Run the full test suite before broad runtime, server, compiler, grammar, or
editor changes:

```bash
corepack pnpm run test
```

Run the full workspace build when package exports, generated output, grammars,
language server code, or VSIX packaging can be affected:

```bash
corepack pnpm run build
```

Run type checks and linting before handing off larger changes:

```bash
corepack pnpm run check
corepack pnpm run lint
```

Format touched source files with:

```bash
corepack pnpm run fmt
```

For narrower work, use the package scripts directly:

```bash
corepack pnpm --dir modules/svelte-effect-runtime run check
corepack pnpm --dir modules/svelte-effect-runtime run build
corepack pnpm --dir modules/svelte-effect-runtime-grammars run test
corepack pnpm --dir modules/svelte-effect-runtime-vsix run package
```

## Coding Style

Use the conventions in `AGENTS.md` when changing source code:

- Function, variable, and method names use `snake_case`.
- Classes, types, interfaces, and components use `PascalCase`.
- File names use `kebab-case.ts`.
- Comments use JSDoc blocks, not `//` comments.
- Imports are grouped and sorted by line length as described in `AGENTS.md`.
- Exported functions, classes, and types need useful JSDoc with `@example`,
  `@since`, `@param`, and `@returns` where applicable.

Prefer focused root-cause fixes over compatibility shims. When adding SER
syntax, update the runtime/compiler behavior, tests, grammars, and language
server support together if users would otherwise get a broken editor or build
experience.

## Tests

Place tests next to the package area they verify under `.tests`:

- Runtime/compiler/server behavior goes in `.tests/svelte-effect-runtime/runtime`.
- Grammar behavior goes in `.tests/svelte-effect-runtime-grammars/runtime`.
- Language server behavior goes in
  `.tests/svelte-effect-runtime-language-server/runtime`.
- VSIX behavior goes in `.tests/svelte-effect-runtime-vsix/runtime`.

When a transform changes generated code, assert on the important generated
shape and on the user-facing behavior. When a bug involves SvelteKit or Effect
control flow, prefer a small fixture that reproduces the boundary instead of a
large app-shaped test.

## Git And Releases

Create a branch for each coherent change. Keep commits focused, use short
conventional messages like `fix: preserve remote failures`, and push the branch
after committing.

Do not push to `master` without explicit human approval. A version change on
`master` can trigger the release workflow, which builds, tests, tags, creates a
GitHub release, publishes packages to npm, and publishes the VS Code extension.

All publishable packages must share the same semantic version:

- `modules/svelte-effect-runtime/package.json`
- `modules/svelte-effect-runtime-grammars/package.json`
- `modules/svelte-effect-runtime-language-server/package.json`
- `modules/svelte-effect-runtime-vsix/package.json`

If those versions drift, the release workflow fails.
