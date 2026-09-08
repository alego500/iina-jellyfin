# Draft: preserve titles and ordering in explicit playback queues

Local only. Branch: `codex/pr-titled-queues`. Base: `codex/pr-jellyfin-12-auth`.

## Problem

Upstream now opens the first album track and defers appending the rest until it loads. This fixes queue replacement, but unplayed entries still need titles, and episodic autoplay must not replace a user-selected sequence.

## Changes

- Keep upstream's first-item opening, deferred append, pending-queue lifetime, and matching checks.
- Append remaining items through an M3U file with EXTINF names so titles exist before those entries are played.
- Sanitize title line breaks and reject non-HTTP or newline-injected stream URLs.
- Remember explicit queue membership, including revisits and the final item, to suppress next-episode automation for that sequence.
- Invalidate an in-flight automatic episode lookup when a manual queue replaces playback.

The change is independent of the playlist browser. It already improves upstream's album Play All behavior. No title prefetch, media warmup, or experimental playback is used.

## Validation

- `pnpm run check`
- `node --test tests/*.test.cjs` — 4 tests including prerequisites.
- Coverage: M3U titles, line-injection rejection, append-after-write, queue revisits/final item, and clearing a selection.

## Manual checks before submission

- Inspect titles of unplayed entries in IINA after album Play All.
- Replace currently playing media with another album and verify the full new queue survives.
- Play an explicit episode list with automatic next episode enabled; revisit entries and reach the final item.
- Test multiple player windows and file-system failure behavior. Temporary files use IINA's `@tmp` location; actual native M3U title presentation has not been manually verified.
