# IINA opening OSD displays a network URL instead of the media title

Investigated on 2026-11-06. This document preserves the findings for a future IINA bug report; no upstream issue has been submitted.

The plugin workaround is published as [draft PR #7](https://github.com/alego500/iina-jellyfin/pull/7) in the personal fork, from `codex/pr-playback-title-osd` to `main`.

## Observed behavior

Environment: IINA 1.5.0 (build 180), bundled mpv 0.41.0, Jellyfin Server 12.2.0, and the personal Jellyfin plugin based on v0.7.5.

The brief on-screen message shown when opening a local file displays its filename. Opening a Jellyfin movie or playlist entry instead displays the network URL. The window/media title and the playlist title are separate displays and can already contain the correct Jellyfin name.

The user confirmed that this command displays the correct name after the initial URL message:

```javascript
iina.core.osd(`Playing: ${iina.core.status.title || 'No Title'}`);
```

This observation alone does not establish when the title first became available. The source code below establishes that IINA's initial message does not consult it at all.

## Source findings

1. In the [`MPV_EVENT_START_FILE` handler](https://github.com/iina/iina/blob/v1.5.0/iina/MPVController.swift#L1046-L1054), IINA calls `player.fileStarted(path:)`, then builds the OSD text from `currentURL`. For network resources it chooses `absoluteString`; for local files it chooses `lastPathComponent`. It sends that text as a `.fileStart` OSD.
2. [`OSDMessage.fileStart`](https://github.com/iina/iina/blob/v1.5.0/iina/OSDMessage.swift#L162-L165) displays the string supplied by that handler. It does not resolve the title later.
3. [`core.status.title`](https://github.com/iina/iina/blob/v1.5.0/iina/JavascriptAPICore.swift#L313-L318) calls `getMediaTitle(withExtension: false)`. That [getter](https://github.com/iina/iina/blob/v1.5.0/iina/PlayerCore.swift#L2903-L2906) reads mpv's `media-title` and falls back to the path. This is why the user's custom OSD can show a different value.
4. [`core.osd()`](https://github.com/iina/iina/blob/v1.5.0/iina/JavascriptAPICore.swift#L56-L60) sends a new custom OSD with a plugin attribution. It does not edit the earlier native message. The exposed [event API](https://github.com/iina/iina/blob/v1.5.0/iina/JavascriptAPIEvent.swift#L11-L14) offers listeners, without a cancellation/replacement return value for the native file-start OSD.
5. IINA has a [File start suppression checkbox](https://github.com/iina/iina/blob/v1.5.0/iina/Base.lproj/PrefUIViewController.xib#L1009-L1017), backed by `disableOSDFileStartMsg`. The [OSD implementation](https://github.com/iina/iina/blob/v1.5.0/iina/OSDMessage.swift#L125-L135) applies this preference to native file-start messages generally, including local files.

Setting `force-media-title` earlier or importing playlist titles through M3U cannot change the network/local URL selection in the first step. Metadata timing may affect when a custom title message is possible, but it is not the only cause of the native URL message.

## Reproduction for a future report

1. Keep IINA's OSD enabled and its File start suppression checkbox unchecked.
2. Open a local video and observe the opening filename message.
3. Open a Jellyfin stream whose media title is known. A sanitized example URL shape is `https://media.example.invalid/Videos/ITEM_ID/stream?static=true&ApiKey=REDACTED`; use a working authorized URL locally.
4. Observe that the native opening message shows the network URL.
5. In that player's plugin developer console, run the command above. Compare the custom title message with the earlier native opening message.
6. Repeat with a single movie and a playlist entry. Both use the same network-resource branch.

Expected behavior for the report: when a usable media title exists, the opening message should display that title. A native fix must also define the fallback and update behavior when the title arrives after the start event, and continue respecting the existing OSD suppression preferences.

Use sanitized URLs and remove credentials from report attachments. No token or authenticated URL is needed to explain the source-level difference.

## Plugin workaround

The plugin now adds **Show playback title when opening Jellyfin media** under **Notifications & UI**. Its preference key is `show_playback_title_osd`, with a default of `true`.

- After a Jellyfin file loads, read `core.status.title` and display `Playing: <title>` if the title is already usable.
- If the existing metadata-title update is still pending, retry the same guarded callback when that update finishes. The OSD helper makes no extra HTTP requests and adds no load delay or polling timer.
- Emit at most one opening-title message per loaded file, including revisits to the same item. Invalidate delayed callbacks when a file ends, another load begins, or another file finishes loading.
- Recheck the toggle before displaying a delayed result. Never repeat an empty title or an HTTP stream URL as the custom title message.
- Keep this toggle independent of `show_notifications`. Suppress the older optional automatic `Title:` notification so it cannot duplicate the new opening message. The manual Set Jellyfin Title action retains its existing notification behavior.
- Keep the separate `set_video_title` preference: it controls fetching/applying Jellyfin metadata titles. If it is disabled, the new OSD can still use an existing embedded media title; it does not fetch a replacement itself.

The workaround can replace the URL message once the title is ready. It cannot guarantee that the native URL message never appears first, and it does not change IINA's global OSD settings or local-file opening messages.

## Validation

Automated coverage exercises immediate and delayed titles, single-item browser playback, direct streams, duplicate-message suppression, the disabled toggle, file replacement/end, local files, and an unavailable OSD bridge. Existing title, playlist, subtitle, and playback-progress regressions remain part of the full test suite.

The isolated review branch passes **105 tests** and `npm run check` (lint and formatting). The complete development working copy passes **119 tests**, including the separate playlist-title and resume follow-ups. After restarting IINA, a live preference read-back confirmed `show_playback_title_osd: true` while `show_notifications: false`. The user completed the requested manual testing on 2026-11-06 and asked to publish the workaround. IINA's global OSD settings were left unchanged.
