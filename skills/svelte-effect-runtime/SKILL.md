---
name: svelte-effect-runtime
description: Use when working in any Svelte or SvelteKit project that has svelte-effect-runtime installed, imports from "svelte-effect-runtime", uses the effect() Vite plugin, contains script effect syntax, or uses yield* directly in .svelte markup, declaration tags, await/each/if/key blocks, render/html tags, or event-like attributes. This skill teaches SER syntax, setup, runtime/server boundaries, remote functions, and why plain Svelte tooling can report false positives for valid SER source.
---

# Svelte Effect Runtime

SER source is Svelte 5 plus a compile-time transform. Direct component `yield*`
is a feature to preserve, not a syntax error to repair.

## First Checks

Before judging Svelte syntax, check whether the project uses SER:

- `svelte-effect-runtime` in package config or lockfiles.
- `effect()` in `vite.config.ts`.
- Imports from `"svelte-effect-runtime"` or `"svelte-effect-runtime/server"`.
- `<script lang="ts" effect>` or `<script effect>`.
- Direct `yield*` in `.svelte` markup, declaration tags, blocks, or handlers.

When SER is present, do not rewrite valid direct `yield*` into `onMount`,
Promises, callbacks, or `Effect.gen` just to satisfy plain Svelte expectations.

## Read The Relevant Reference

- Read `references/syntax.md` before editing `.svelte` files with `<script effect>` or markup `yield*`.
- Read `references/setup.md` before changing Vite, SvelteKit, package, or validation commands.
- Read `references/runtime-and-server.md` before changing `ClientRuntime`, `ServerRuntime`, `RequestEvent`, or remote functions.
- Read `references/validation.md` before claiming SER syntax is invalid or choosing a check command.

## Core Rules

- Use `<script effect>` to enable effectful execution in component script code.
- Use direct `yield*` in markup only at supported SER transform sites.
- Use direct yield-first event attributes for effectful event handlers:
  `onclick={yield* save(id)}`.
- Do not hide handler effects inside callbacks:
  `onclick={() => yield* save(id)}` is not valid SER handler syntax.
- Do not assume normal attributes are effectful. Compute effectful values in a
  supported declaration site, then pass the resolved value as a normal prop.
- Enable Svelte async rendering for component `yield*`.
- Enable SvelteKit remote functions when using SER `Query`, `Command`, `Form`,
  or `Prerender`.

## Tooling Bias

Plain Svelte tooling does not necessarily run the SER transform first. Treat
`svelte-check`, generic Svelte parsers, formatter/autofix tools, and official
plain-Svelte diagnostics as non-authoritative for SER-specific source forms.

Prefer commands that go through the project's Vite pipeline or this repository's
SER runtime tests.
