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
- If the existing metadata-title update is still pending, retry the same guarded callback when that update finishes. The OSD helper makes no extra HTTP requests or load delay.
- If the playback tracker requests an automatic Jellyfin resume, arm one post-resume notification after `core.seekTo()` succeeds. Handle `mpv.playback-restart` and verify that the same playlist entry is still active and the reported position is within two seconds of the saved target before sending that notification.
- Consume the pending completion flag before notifying, so duplicate restart events and later manual seeks cannot trigger additional messages. Drop delayed callbacks when a file ends or another file loads.
- Recheck the toggle before displaying a delayed result. Never repeat an empty title or an HTTP stream URL as the custom title message.
- Keep this toggle independent of `show_notifications`. Suppress the older optional automatic `Title:` notification so it cannot duplicate the new opening message. The manual Set Jellyfin Title action retains its existing notification behavior.
- Keep the separate `set_video_title` preference: it controls fetching/applying Jellyfin metadata titles. If it is disabled, the new OSD can still use an existing embedded media title; it does not fetch a replacement itself.

The workaround can replace the URL message once the title is ready. It cannot guarantee that the native URL message never appears first, and it does not change IINA's global OSD settings or local-file opening messages.

### Resume-completion detection

The extra title depends on the existing Jellyfin resume lookup: the item must be unwatched and its saved position must meet the existing 15-second minimum. The existing one-second resume delay and playback-progress protections remain unchanged. No resume, a watched item, an insignificant position, disabled progress sync, or a failed seek produces no second title message.

IINA [handles playback-restart](https://github.com/iina/iina/blob/v1.5.0/iina/MPVController.swift#L1074-L1089) after seeking, then [delivers the event to plugins on its main queue](https://github.com/iina/iina/blob/v1.5.0/iina/MPVController.swift#L1141-L1147). This places the new title after its native seek message. Merely calling `seekTo()` or sampling a position is not used as proof that the seek completed. A premature restart event away from the saved target leaves completion pending for the real event.

If the title itself arrives only after resume, the guarded metadata callback displays it once then. The title helper uses no timers or extra resume requests. IINA's own OSD settings determine when the message fades out.

### Earlier local experiments

The user reported that the approximately one-second delayed resume seek overwrites the title message, then tested and confirmed that repeating the title for five seconds works. A subsequent local experiment added a 2–10 second repeat-length slider. The requested alternative now replaces both with a single notification after confirmed resume completion; the slider, its default preference, and its custom binding script have been removed. Old saved duration values are ignored. PR #7 now includes the resume-completion implementation. The timed repeats and duration slider are not part of that PR.

## Validation

Automated coverage exercises immediate and delayed titles, single-item browser playback, direct streams, asynchronous resume completion, premature and duplicate restart events, insignificant resume points, watched items, failed seeks, the disabled toggle, file replacement/end, local files, and an unavailable OSD bridge. Existing title, playlist, subtitle, and playback-progress regressions remain part of the full test suite.

At publication, the original single-announcement review branch passed **105 tests** and `npm run check` (lint and formatting), and the combined development working copy passed **119 tests**. After restarting IINA, a live preference read-back confirmed `show_playback_title_osd: true` while `show_notifications: false`. The user completed the requested manual testing on 2026-11-06 and asked to publish that workaround. IINA's global OSD settings were left unchanged.

The fixed five-second follow-up passed **123 tests** and `npm run check`, and the user confirmed its live behavior during resume. The superseded slider follow-up passed **128 tests** and `npm run check`. The resume-completion implementation passes **116 tests** and `npm run check` on the isolated PR #7 branch. The combined development copy passes **125 tests**, including the separate playlist-title and progress-reporting fixes. The PR tests cover actual asynchronous completion, stale playlist-entry IDs, playlist reordering, disabled progress sync, failed seeks, and duplicate events while retaining the existing resume regressions. Live verification of the event-based alternative remains with the user.
