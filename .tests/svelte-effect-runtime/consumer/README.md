# SER conformance consumers

The harness copies fixed native and SER fixtures into isolated applications under
`.dist/conformance/applications`. Native SvelteKit is the oracle. Stable SER defaults to the
published non-Effect `4.0.0` artifact and applies its checked-in target adapter, while candidate
SER is built and packed from the current checkout. `SER_STABLE_TARGET` and
`SER_CANDIDATE_TARGET` accept `package:<specifier>`, `artifact:<path>`, or `git:<ref>`.

The stable target adapter wraps the release's native `Prerender` promise in SER-owned Effect
execution. Candidate exercises the Effect-yieldable `Prerender` contract directly, while both
targets expose the same rendered observation.

Each application runs install, SvelteKit sync, type, SER-aware Vite compilation, production build,
and adapter-node startup as distinct phases. The fixtures never alias SER source. Phase logs,
artifact hashes, target metadata, browser traces, console events, and network observations are
written under `.dist/conformance`.

Portless owns and registers every production server on a fixed loopback application port. Browser
drivers use the named HTTPS origins, while Playwright readiness probes use side-effect-free direct
endpoints so startup cannot open a live query. The fixed ports are normalized from recorded
observations. The fixtures avoid SvelteKit's build-time `paths.origin`, which would recursively
route native remote SSR.

The pinned adapter-node patch normalizes the adapter's Windows transform filter and awaits
SvelteKit 3's asynchronous Node request adapter. It is installed identically in every target and
keeps the exercised server on adapter-node's production entrypoint.

Known deviations stay executable and preserve raw evidence. Stable 4.0.0 differs from native for
batch collection, indexed form paths, Effect-backed HTML/render sites, and live-stream disposal.
The current candidate fixes the first three; the lifecycle scenario records the remaining candidate
defect by proving that native finalizes on page closure while both SER targets retain their streams.
The production fix is tracked separately in GitHub issue #30.

The fast lane uses the repository's primary SvelteKit version and Chromium. The broad lane adds
Firefox and WebKit and accepts an exact `SVELTEKIT_VERSION`; CI matrix scheduling remains issue #29.
