# Draft: fix Jellyfin 12 authentication in the sidebar and media URLs

Local only. Branch: `codex/pr-jellyfin-12-auth`. Base: upstream main `49c7a37` (v0.7.2).

## Problem

Jellyfin 12 disables legacy authorization by default. The core already uses a MediaBrowser Authorization header, but sidebar API calls send `X-Emby-Token` and generated stream/artwork/subtitle URLs use `api_key`. On a Jellyfin 12.0.0 server these legacy forms returned 401, while the same token succeeded through the modern header and `ApiKey` query parameter.

## Changes

- Reuse the sidebar's existing MediaBrowser header builder for authenticated requests.
- Generate `ApiKey` URLs and percent-encode token values consistently across runtime and sidebar helpers.
- Normalize legacy token parameter names on authenticated media links during `on_load`, preserving reverse proxy paths, other query values, and fragments.
- Add a minimal Node test harness and authentication regression tests.

This does not enable legacy authorization on the server, change login storage, add new permissions, or introduce the personal fork's branding.

## Validation

- `pnpm run check`
- `node --test tests/*.test.cjs` — 2 tests on this branch.
- Read-only Jellyfin 12 probes: modern header/query succeeded; legacy header/query failed; the combined fork's modern static-stream URL returned a successful byte range.

## Manual checks before submission

- Login and Quick Connect in sidebar and standalone browser.
- Movies, music, artwork, resume/progress reporting, and external subtitles.
- Existing Jellyfin 10/11 installations and Jellyfin 12 with default settings.
- Existing legacy media links and reverse proxy deployments.

These manual checks have not been completed. Do not claim full end-to-end compatibility from the API probes alone.
