# SER conformance consumers

The harness copies fixed native and SER fixtures into isolated applications under
`.dist/conformance/applications`. Native SvelteKit is the oracle. Stable SER defaults to the
published `4.1.0` artifact with the current Effect fixture, while candidate SER is built and packed
from the current checkout. `SER_STABLE_TARGET` and
`SER_CANDIDATE_TARGET` accept `package:<specifier>`, `artifact:<path>`, or `git:<ref>`.

Shared Query and root-page scenarios compare the published release and candidate at the same
Effect-backed target boundary when the selected framework profile supports both. A profile newer
than the published release compares the candidate directly with native SvelteKit, so an obsolete
baseline cannot prevent the candidate from running. A dedicated `/prerender` route exercises SER's
public `Prerender` export in a production server.

Each application runs install, SvelteKit sync, TypeScript, Svelte diagnostics, production build,
and adapter-node startup as distinct phases. The check phase runs published `svelte-check` against
the packed consumer source; SER targets first apply the transform exported by their installed
artifact, then restore the authored source after diagnostics complete. The fixtures never alias SER
source. Phase logs, startup stdout and stderr, artifact hashes, target metadata, browser traces,
console events, and network observations are written under `.dist/conformance`.

Portless owns and registers every production server on a fixed loopback application port. Browser
drivers use the named HTTPS origins, while Playwright readiness probes use side-effect-free direct
endpoints so startup cannot open a live query. The fixed ports are normalized from recorded
observations. SvelteKit 3 fixtures compile with the canonical direct adapter origin, while the
SvelteKit 2 profile omits the unsupported `paths.origin` option. Browser parity still drives the
direct adapter URLs under both profiles, so remote-function and CSRF checks remain active.

The compatibility matrix pins two reviewable profiles. `kit-2-stable` uses SvelteKit 2.70.2 and its
peer-compatible adapter-node 5.5.7. `kit-3-primary` uses SvelteKit 3.0.0-next.25 and adapter-node
6.0.0-next.10. Every target receives unpatched framework artifacts, and the Kit 3 profile verifies
that adapter output contains client assets and resolves its emitted static root to the application
build directory. Older Kit 3 prereleases remain selectable for diagnosis; the harness reports
[upstream issue #16365](https://github.com/sveltejs/kit/issues/16365) on Windows when one requires
the affected adapter-node 6.0.0-next.3 instead of applying a local framework patch.

`corepack pnpm run check:conformance:matrix` installs, synchronizes, type-checks, SER-checks, and
builds packed native, stable, and candidate consumers under every profile available on the current
platform, preserving its evidence under `.dist/conformance-matrix` so it cannot overwrite a browser
run. A full server and browser run selects one profile with `SVELTEKIT_PROFILE=kit-2-stable` or
`SVELTEKIT_PROFILE=kit-3-primary` before `test:conformance`; an exact 2.x or 3.x
`SVELTEKIT_VERSION` remains available for upgrade diagnosis and selects the compatible adapter
generation automatically. Matrix automation and scheduling in CI remain issue #29.

The published stable release and candidate are both expected to match native behavior. Historical
deviations remain traceable through issues #30, #33, #34, #35, and #36. Issue #31 tracks the compiler
diagnostic that identifies its public error correctly but loses the source position. The browser
lane writes each observation and comparison to `.dist/conformance/evidence`.

The earlier regression corpus remains traceable at stronger seams:

- Issue #6 maps to concurrent request isolation plus Handler and `RequestEvent` observations.
- Issues #9 and #10 map to packed installation, exact browser/server conditions, and production
  adapter-node startup.
- Issue #12 maps to Query resource identity, cache state, refresh, and preserved property behavior.
- Issue #17 maps to complete compiler goldens plus execution of every supported markup yield site.
- Issue #18 maps to exact package exports and real `Query.batch` execution.
- Issue #19 maps to enhanced, unenhanced, keyed, invalid, transformed, pending, reset, and redirect
  form scenarios.
- Issue #21 maps to the pinned SvelteKit 2 and SvelteKit 3 compatibility matrix.

The fast lane uses the repository's primary SvelteKit profile and Chromium. The broad lane adds
Firefox and WebKit on Linux and macOS. On Windows it runs Chromium and WebKit because Firefox rejects
Portless's local HTTPS certificate before any application request reaches SvelteKit; this platform
constraint remains visible instead of being hidden behind retries or an HTTP-only fixture.
