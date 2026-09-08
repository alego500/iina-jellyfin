# Draft: add Jellyfin playlist browsing and complete Play All queues

Local only. Branch: `codex/pr-playlist-browser`. Base: `codex/pr-titled-queues`.

## Changes

- Add a Playlists tab, playlist search chip, item details view, and Open in Jellyfin action.
- Add Play All controls above playlist/album item lists and use upstream's `play-media-list` message flow.
- Fetch every page of playlist listings and playlist contents in pages of 100 instead of silently truncating long playlists.
- Preserve server order and duplicate entries; filter out folders/non-playable containers.
- Use audio/video stream routes and descriptive music/movie/episode titles, including season 0.
- Escape server-supplied playlist text and attributes; cancel stale results after navigation or server changes.

## Upstream overlap

Upstream already implements album Play All, deferred queue append, stale-request protection, HTML escaping, and correct streaming routes. This proposal builds on those changes rather than duplicating the old fork's opening/session workarounds.

## Validation

- `pnpm run check`
- `node --test tests/*.test.cjs` — 8 tests including prerequisites.
- Tests cover pagination beyond 100 entries, duplicate ordering, a changed-server response, audio/video routing, season 0, and HTML escaping.
- Read-only checks against Jellyfin 12 fetched the existing playlist's 80 entries. Pagination beyond one page is covered by synthetic fixtures, not by that live playlist.

## Manual checks before submission

- Playlist tab and search, open/back navigation, Open in Jellyfin, empty/error states.
- Play All with no visible player, with a playing item, and from the standalone browser.
- Long playlists, mixed media, unavailable media, and switching servers during loading.
- Confirm titles and queue order in the native IINA playlist; these GUI checks remain outstanding.
