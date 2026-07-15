# SER conformance consumers

The harness copies fixed native and SER fixtures into isolated applications under
`.dist/conformance/applications`. Native SvelteKit is the oracle. Stable SER defaults to the
published non-Effect `4.0.0` artifact and applies its checked-in target adapter, while candidate
SER is built and packed from the current checkout. `SER_STABLE_TARGET` and
`SER_CANDIDATE_TARGET` accept `package:<specifier>`, `artifact:<path>`, or `git:<ref>`.

Shared Query and root-page scenarios normalize the stable release's Promise-backed `Prerender`
value and the candidate's Effect-backed adapter at the target boundary. A dedicated `/prerender`
route still exercises SER's public `Prerender` export in a production server, so the known emitted
binding defect remains executable without preventing unrelated scenarios from running.

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

The compatibility matrix pins two reviewable profiles. `kit-2-stable` uses SvelteKit 2.69.3 and its
peer-compatible adapter-node 5.5.7. `kit-3-primary` uses the repository's SvelteKit 3.0.0-next.6 and
adapter-node 6.0.0-next.3. The Kit 3 adapter patch normalizes its Windows transform filter and awaits
SvelteKit 3's asynchronous Node request adapter; Kit 2 uses the unpatched adapter 5 release. Every
target in a profile receives the same framework and adapter versions.

`corepack pnpm run check:conformance:matrix` installs, synchronizes, type-checks, SER-checks, and
builds packed native, stable, and candidate consumers under both profiles, preserving its evidence
under `.dist/conformance-matrix` so it cannot overwrite a browser run. A full server and browser run
selects one profile with `SVELTEKIT_PROFILE=kit-2-stable` or
`SVELTEKIT_PROFILE=kit-3-primary` before `test:conformance`; an exact 2.x or 3.x
`SVELTEKIT_VERSION` remains available for upgrade diagnosis and selects the compatible adapter
generation automatically. Matrix automation and scheduling in CI remain issue #29.

Known deviations stay executable and preserve raw evidence. Stable 4.0.0 differs from native for
batch collection, indexed form paths, Effect-backed HTML/render sites, and live-stream disposal.
The current candidate fixes the first three. Issues #30, #33, #34, #35, and #36 track the remaining
page-disposal, request-abort, Prerender binding, live-query ESM, and Command compatibility defects.
Issue #31 tracks the compiler diagnostic that identifies its public error correctly but loses the
source position. Every deviation names its issue beside the exact comparison path, and the browser
lane writes the corresponding observation and comparison JSON to `.dist/conformance/evidence`.

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
