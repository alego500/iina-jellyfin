# Draft: normalize credentials in older Jellyfin media links

Branch: `codex/pr-legacy-media-links`. Base: upstream `main` at `b7a5191` (v0.7.5). Status: local, unpublished.

## Problem and result

Upstream generates Jellyfin 12-compatible URLs, but an older shared download/stream link can still contain `api_key`, `api-key`, or `x-emby-token`. These links fail when the server disables legacy authorization. Convert those query parameter names to `ApiKey` before mpv opens the media, preserving encoded values, reverse proxy paths, other parameters, and fragments.

The priority-10 async load hook runs before the upstream priority-50 title hook and always continues loading, including after property errors. Explicit modern credentials take precedence. Local paths and unrelated web links are unchanged.

## Validation

- `pnpm test`: 75 passing tests, including three normalization regressions.
- `pnpm run check`: lint and formatting pass.
- Previous server testing established that modern authentication worked on Jellyfin 12 while legacy transports returned 401. Those September probes were not rerun for this update.

Manual follow-up: open an older authenticated media link in IINA with a current server login and default Jellyfin 12 authorization settings.

This replaces the earlier broad Jellyfin 12 authentication draft: upstream already merged the core authentication changes in [PR #94](https://github.com/mhajder/iina-jellyfin/pull/94). Only normalization of incoming older links remains in this proposal.
