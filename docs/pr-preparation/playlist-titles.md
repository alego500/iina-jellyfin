# Populate titles for unplayed Jellyfin playlist entries

Implemented and verified on 2026-11-06. Review branch: `codex/pr-playlist-titles`, based on the personal fork's `main` at `fe40642`.

## Problem and result

Play All already supplies each item's Jellyfin title, but IINA's native `playlist.add()` accepts only URLs. Unplayed entries consequently display stream URLs until their videos open. The same limitation affects playlists opened through Jellyfin web links.

The remaining entries now arrive with their titles immediately after the first item loads. This covers album and playlist Play All from both browser surfaces and resolved Jellyfin playlist web links. It uses the titles already present in the list, without starting queued videos or fetching their metadata individually.

## Implementation

- Keep the existing first-item opening, deferred append, pending-queue expiry, and loaded-item checks.
- Build an extended M3U with `#EXTINF:-1,<title>` records and pass it to mpv's `loadlist` command through `memory://`, using `append` mode. No temporary playlist file is created.
- Refresh IINA's cached playlist and its native UI with an empty `playlist.add([], -1)` batch after the import. This adds no further entries.
- Preserve order, duplicate URLs, commas, and Unicode. Replace title line breaks and NULs with spaces; reject non-HTTP or multiline stream URLs.
- Respect the existing `set_video_title` preference. Disabled titles or a list without names use the existing native URL append.
- Compare playlist lengths before and after import. Fall back to native URL append only when nothing was added; avoid duplicating entries after a partial import or a display-refresh failure.

The installed IINA 1.5.0 uses mpv 0.41.0, whose `playlist/N/title` property is read-only. Extended M3U metadata provides the titles on that version. This implementation is a new, limited use of M3U import; it does not restore the earlier temporary-file queue manager, title warmup, or custom autoplay suppression.

Playback tracking, resume behavior, authentication, plugin identity, version numbers, and preference defaults are unchanged by this fix. The separate uncommitted resume follow-up is excluded from the review branch.

## Verification

- Clean review branch: `npm test` passes all **98 tests**; `npm run check` passes lint and formatting. The complete development working copy has 104 tests because it also contains the separate resume follow-up.
- Automated coverage includes the 80-item queue, web-link integration, commas, Unicode, duplicates, title sanitization, disabled titles, rejected imports, partial imports, and refresh failures.
- An isolated test against IINA's bundled mpv 0.41.0 confirmed that the in-memory M3U supplies titles while playback remains idle.
- Live IINA verification against Jellyfin 12.2.0: the reopened 74-item playlist displayed titles in its native playlist panel, including unplayed entries. Playback remained paused.
- Read-only API comparisons confirmed that the three checked resume positions and watched flags were unchanged during inspection.
- The user also tested the behavior and confirmed that testing was sufficient.

## Review scope

Publish as a separate draft PR to `alego500/iina-jellyfin`, targeting `main`. Existing draft PRs #1–#5 retain their current branches and descriptions. This PR adds titles to the complete personal fork; it is not an upstream submission or a change to the existing PR dependency chain.
