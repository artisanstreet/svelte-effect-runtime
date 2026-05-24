# V2 Plan - Svelte Effect Runtime

## Status

Current: runtime core implemented, docs migrated to Fumadocs, and a current
package browser smoke exists. V2 is not yet declared complete because the live
smoke matrix still needs remote-function coverage and a final thermonuclear
self-review.

Effect dependency: `npm:effect@beta` (`4.0.0-beta.66` at last verification).

## Architecture

```text
Source -> Detection -> Script lowering -> Markup lowering -> Dispatcher
                                                        |
                                              fork() value()
                                              run()  promise()

Server-side:
  .remote.ts -> server.ts -> run_remote_effect() -> ManagedRuntime
                          -> Query / Command / Form / Prerender

Client-side:
  vite.ts -> generated __sveltekit/remote facade
          -> remote/client.ts adapters
          -> Effect-returning query / command / form APIs
```

## What's Done

| Component | File | Evidence |
| --- | --- | --- |
| `yield*` detection | `src/detect.ts` | Unit coverage in `v2/detect.test.ts` |
| Dispatcher lifecycle | `src/dispatcher.ts` | Unit coverage in `v2/dispatcher.test.ts` |
| Script effect lowering | `src/preprocess.ts` | Unit and integration coverage |
| Markup effect lowering | `src/markup/transform.ts` | Unit and integration coverage |
| Markup helpers | `src/markup/{value,promise,run}.ts` | Covered through markup and smoke tests |
| Remote shared errors | `src/remote/shared.ts` | Unit coverage in `v2/remote-shared.test.ts` |
| Remote server helpers | `src/remote/server.ts` | Unit coverage in `v2/remote-server.test.ts` |
| Remote client adapters | `src/remote/client.ts` | Runtime and type-level coverage |
| Runtime package build | `build/runtime.ts` | `deno task build:runtime` |
| Current package browser smoke | `build/smoke-current-runtime.ts` | `deno task smoke:runtime` |
| Docs app | `modules/docs` | Fumadocs/Next build via `npm run build` |

Current runtime test suite: 148 tests under `.tests/svelte-effect-runtime/v2/`.

## Verification Commands

```sh
deno lint
deno task check:runtime
deno task test:runtime
deno task build:runtime
deno task smoke:runtime
cd modules/docs && npm.cmd run build
```

## Remaining Before 100%

- Add a live smoke that exercises current-package remote query, command, form,
  and prerender behavior in a SvelteKit app.
- Decide whether the existing `reset_dispatcher()` internal test utility should
  stay internal or move behind a test-only entrypoint.
- Run the full completion audit against the original objective.
- Run `$thermo-nuclear-code-quality-review` against the finished branch and fix
  any findings before calling V2 complete.

## Notes

- The old `lowering.ts` placeholder has been removed. Lowering logic lives in
  `preprocess.ts` and `markup/transform.ts`.
- The old VitePress docs and custom Vercel fallback API have been removed.
- Existing legacy smoke apps under `Code/smokes/ser-v2*` may still reference an
  old `1.6.2` tarball. The repeatable current-package smoke is
  `deno task smoke:runtime`, which recreates `Code/smokes/ser-v2-current`.
