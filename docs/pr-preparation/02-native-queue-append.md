# Draft: append library queues through IINA's playlist API

Branch: `codex/pr-native-queue-append`. Base: upstream `main` at `b7a5191` (v0.7.5). Status: local, unpublished.

## Problem and result

Library Play All currently appends each queued entry with a raw mpv command. Use `iina.playlist.add(urls, -1)` to add the remaining media as one batch through IINA's own playlist model and UI.

Keep upstream's opening lifecycle: open the first file normally, wait for its file-loaded event, verify that it belongs to the pending queue, then append the rest. Existing queue expiry remains in place. The package test command includes the queue regression tests as well as upstream's suite.

## Tradeoff and upstream overlap

Upstream v0.7.5 already fixes comma-containing title options with `mediaTitleOption`. This proposal is about using the native playlist interface and preserving the fork's verified queue behavior; it must not be presented as a fix missing from current upstream.

Queued entries carry URLs rather than per-file title options. Upstream's title hook still names them when they open. Unplayed entries may display a URL until then. No temporary M3U files, title warmup, or custom autoplay suppression is added.

## Validation

- `pnpm test`: 73 passing tests, including the 80-entry queue regression.
- `pnpm run check`: lint and formatting pass.
- The native append path was previously verified in IINA with the 80-item subscriptions playlist. The updated v0.7.5 build has not been retested through the GUI in this session.

Manual follow-up: Play All from both browser surfaces while media is playing and while no player is visible; confirm queue order, duplicates, navigation, and title behavior.
