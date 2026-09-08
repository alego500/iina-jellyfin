# Draft: open saved-server Jellyfin web links directly in IINA

Local only. Branch: `codex/pr-web-links`. Base: `codex/pr-titled-queues`. Does not depend on the playlist browser proposal.

## Changes

- Recognize modern `/web/#/details?id=…` and legacy `/web/index.html#!/details?id=…` links, including reverse proxy paths.
- Resolve movie, episode, music, video, and playlist metadata before mpv opens the stream.
- Reuse credentials only for the exact saved server base URL; prefer the active matching account. Validate item IDs and never copy a token to a merely similar host or path.
- Fetch playlist pages in order, retain duplicates, and open titled audio/video stream URLs using modern Jellyfin authentication.
- Append remaining playlist entries only after the first file loads, sharing upstream's lifecycle and the titled-queue helper.
- Account for IINA reporting the original web URL after mpv opens the resolved stream; always continue the load hook, including on errors, and ignore replaced asynchronous resolutions.

## Validation

- `pnpm run check`
- `node --test tests/*.test.cjs` — 10 tests including prerequisites.
- Parser tests cover current/legacy URLs, reverse proxies, and rejected routes/IDs.
- Resolver tests cover active-account selection, pagination, mixed-media titles, and credential isolation.
- Mocked native-entry tests cover pre-load resolution, deferred single append, autoplay suppression, hook continuation on property errors, and replaced loads.

## Manual checks before submission

- Paste a movie, episode, audio, and playlist web link into IINA Open URL.
- Test no saved login, expired login, unsupported item, and inaccessible server cases.
- Verify titles, progress reporting, and playlist continuation after a web-link load in real IINA.
- Repeat behind a reverse proxy. Mocked hook tests are not a substitute for native playback validation.
