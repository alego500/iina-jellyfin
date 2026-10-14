# Draft: open Jellyfin web details links directly in IINA

Branch: `codex/pr-web-links`. Base: `codex/pr-native-queue-append` on upstream v0.7.5. Published draft: [PR #3](https://github.com/alego500/iina-jellyfin/pull/3) in the personal fork; depends on PR #1.

## Result

Users can paste a Jellyfin details link into IINA Open URL. The plugin resolves movie, episode, audio, video, and playlist metadata into playable stream URLs using the saved login for that exact server.

Recognize both `/web/#/details?id=…` and `/web/index.html#!/details?id=…`, including reverse proxy paths. Validate item IDs and prefer the active matching account; credentials are never reused for a different host, scheme, or base path.

Playlist pages retain order and duplicates. Open the first item normally and append the rest after it loads through the native queue prerequisite. Handle IINA reporting the original web URL, ignore replaced asynchronous loads, and always continue the mpv hook.

Resolution runs at priority 40, before upstream's priority-50 title hook, and calls upstream's managed title setter. This respects the title preference and retains upstream's stale-title cleanup.

## Validation

- `pnpm test`: 80 passing tests, including parser formats, proxy paths, rejected IDs, credential isolation, pagination, mixed media, deferred append, cancelled loads, hook continuation, and integration with upstream's title hook.
- `pnpm run check`: lint and formatting pass.

Manual follow-up: movie, episode, audio, and playlist links; no/expired saved login; reverse proxy deployment; native playback and progress reporting in IINA 1.5. These GUI checks were not performed in this update.

## Dependencies

Review against the native queue branch. This feature is independent of the playlist browser and legacy-link normalizer. No personal branding or release metadata is included.
