# Draft: browse and play Jellyfin playlists from IINA

Branch: `codex/pr-playlist-browser`. Base: `codex/pr-native-queue-append` on upstream v0.7.5. Status: local, unpublished.

## Result

Add a Playlists tab and search filter to the browser. Users can inspect a playlist's items, play an individual entry, open the playlist in Jellyfin, or use Play All to queue its complete contents in the current IINA window.

Playlist listings and contents are fetched in pages of 100, preserving server order and duplicate entries. Folders and non-playable containers are excluded from playback. Album and playlist Play All share the existing playback message flow and native queue prerequisite; the controls sit above their item lists.

The feature follows upstream's request-ticket guards and HTML escaping, including when changing servers or navigating away. It includes descriptive item text and audio/video routes, including season 0.

## Validation

- `pnpm test`: 77 passing tests, including upstream's suite and pagination, duplicate order, changed-server responses, mixed media, season 0, escaping, and an 80-entry queue regression.
- `pnpm run check`: lint and formatting pass.
- Native queue behavior was verified during the earlier 80-item subscriptions playlist fix; the v0.7.5 GUI has not been retested in this session.

Manual follow-up: playlist search and navigation, empty/error states, long and mixed playlists, switching servers during loading, and Play All from both browser surfaces.

## Dependencies

Review against the native queue branch so only playlist UI/library additions appear. The feature does not depend on web-link opening or legacy-link normalization. No personal branding or release metadata is included.
