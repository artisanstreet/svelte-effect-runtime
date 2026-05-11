# examples

Runnable example apps that exercise `svelte-effect-runtime`. Mirrors the
Rust convention of `examples/<name>` next to the crates: each
subdirectory is a self-contained project with its own `package.json`,
installs SER from npm, and is not part of the workspace build.

| Example | Stack | What it demonstrates |
| --- | --- | --- |
| [`sveltekit/`](./sveltekit) | SvelteKit + Effect | Gallery of every remote-function kind (`Form`, `Query`, `Command`, `Prerender`) with a persistent sidebar. Useful as a feature reference and as a smoke test against new SER releases. |

## Conventions for new examples

- One subdirectory per example. Name it for the stack or the feature it
  showcases (`sveltekit`, `cloudflare-worker`, `effect-gen`, …).
- Pull SER from npm (`"svelte-effect-runtime": "^1.5.0"` etc.). Avoid
  workspace-relative `file:` references — examples should reproduce
  what a fresh user gets.
- Include a `README.md` with a one-line summary and a runnable
  `npm install && npm run dev` walkthrough.
- Keep build artefacts out of git; the root `.gitignore` already covers
  `**/node_modules` and `**/.svelte-kit`.
- Examples are not built by the runtime's CI; they are intended to be
  run by hand when iterating on releases or onboarding new users.
