# Upstream integration and local PR drafts

Prepared 2026-09-08. Nothing in this directory has been submitted to GitHub, and no branches have been pushed.

## Result

- Original project: [mhajder/iina-jellyfin](https://github.com/mhajder/iina-jellyfin).
- Personal remote: [alego500/iina-jellyfin](https://github.com/alego500/iina-jellyfin).
- Previous local main: `3de8dbc`, already merged through upstream v0.7.1.
- Integrated upstream: `49c7a37`, v0.7.2, released 2026-08-14; 47 upstream commits were missing from the previous main.
- The fork remains **Jellyfin by alego500**, identifier `com.alego500.iina-jellyfin`; existing settings and saved logins continue to use that identifier.
- Version values are now `0.7.2` in `Info.json`, `package.json`, the release manifest, and the runtime client identity. `Info.json`'s `ghVersion` is `12`. Upstream's ESLint update is `^10.8.0` → `^10.8.1` with the corresponding lockfile changes.

## Jellyfin 12 compatibility gate

The installed server reports **12.0.0**. Upstream v0.7.2 is not fully compatible with its default authentication configuration: the core already builds a modern MediaBrowser header, but the sidebar still sent `X-Emby-Token`, and generated media/artwork URLs used `api_key`.

Using the plugin's existing login, read-only probes confirmed:

| Request                                                        | Result                                   |
| -------------------------------------------------------------- | ---------------------------------------- |
| Public server information                                      | 200; version 12.0.0                      |
| `/Users/Me`, modern `Authorization: MediaBrowser … Token="…"`  | 200                                      |
| `/Users/Me`, legacy `X-Emby-Token`                             | 401                                      |
| `/Users/Me`, legacy `api_key` query                            | 401                                      |
| `/Users/Me`, modern `ApiKey` query                             | 200                                      |
| Library items, item metadata, PlaybackInfo, user views         | 200                                      |
| Playlist listing and playlist contents                         | 200; 80 entries in the existing playlist |
| Static stream with modern `ApiKey`, a 1,024-byte range request | 206; 1,024 bytes read                    |

The authentication patch keeps modern defaults; server legacy authorization was not enabled. No playback-reporting POSTs or watch-state mutations were performed. This is targeted compatibility validation, not certification of every Jellyfin 12 feature. Quick Connect, subtitle downloads, actual IINA playback/progress reporting, and end-to-end multi-item playback still need a manual smoke test.

References: [Jellyfin 12 release](https://github.com/jellyfin/jellyfin/releases/tag/v12.0), [server authorization implementation](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs).

## Upstream overlap with the personal fork

| Area                             | What upstream added                                                                                                             | Integration decision                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Album Play All                   | Full album queue, deferred append after the first file loads, correct playlist clearing                                         | Reuse upstream's opening lifecycle; add only titled M3U append and protection from automatic episode queue replacement             |
| Browser without a visible player | Working standalone messaging, correct window API calls, reopen after player closure                                             | Use upstream instead of the fork's older window workarounds                                                                        |
| Sessions and credentials         | Reuse signed-in sessions, retain URL sessions, notify both browser views, respect auto-login preference                         | Adopt upstream; retain the fork's stricter complete-server-base boundary for connected-account reporting                           |
| Asynchronous work                | Drop stale sidebar responses, resume positions, and playback session starts                                                     | Adopt upstream's targeted guards instead of the fork's broad delayed post-load workaround; extend request guards to playlist views |
| Security                         | Escape server text in HTML and redact credentials in logs                                                                       | Adopt upstream and apply the same HTML escaping to playlist entries                                                                |
| Media correctness                | Stream endpoints rather than downloads, working external-subtitle routes, reverse proxy paths, season 0 and episode-number gaps | Adopt upstream and use its stream conventions in the added features                                                                |
| Plugin lifecycle                 | Remove subscriptions to events that never fire; fix global handlers, shortcut, end-of-playback reporting                        | Adopt upstream                                                                                                                     |
| Distinct personal features       | No dedicated playlist browser, named explicit queues, or saved-server web details resolver upstream                             | Keep and prepare as separate feature branches                                                                                      |

Earlier experimental title prefetch/warmup work had already been removed in the personal history; it is not reintroduced. The old load-failure retry is replaced by a pre-load resolver with guaranteed hook continuation and a test for replaced loads.

## Local review branches

A PR compares a branch with a base. These branches exclude personal branding and release metadata. Review only the difference from the listed base, so prerequisite changes do not appear as part of the next proposal.

| Draft                                                | Local branch                | Review base                  | Tip       |
| ---------------------------------------------------- | --------------------------- | ---------------------------- | --------- |
| [Jellyfin 12 authentication](01-jellyfin-12-auth.md) | `codex/pr-jellyfin-12-auth` | `upstream/main` at `49c7a37` | `a6dfb0b` |
| [Titled playback queues](02-titled-queues.md)        | `codex/pr-titled-queues`    | `codex/pr-jellyfin-12-auth`  | `dc0be4b` |
| [Playlist browser](03-playlist-browser.md)           | `codex/pr-playlist-browser` | `codex/pr-titled-queues`     | `762470d` |
| [Open web links](04-web-links.md)                    | `codex/pr-web-links`        | `codex/pr-titled-queues`     | `a817e4d` |

Playlist browsing and web-link opening are sibling branches: neither requires the other. The authentication fix is a new compatibility proposal, not a pre-existing personal feature. The complete integration is on `main` and `codex/integrate-upstream-0.7.2`; the separate PR commits are preserved on their own branches, not submitted as a combined proposal. The complete-server-base reporting guard and personal branding remain fork-only changes.

Example local review:

```sh
git diff codex/pr-titled-queues...codex/pr-playlist-browser
git log --oneline codex/pr-titled-queues..codex/pr-web-links
```

Do not submit these branches directly against upstream main while their prerequisites are unmerged: that would include prerequisite commits. If publication is later authorized, submit the authentication fix first, then rebase the dependent proposals onto upstream as prerequisites land. No publishing commands were run.

## Changed files and validation

- `src/index.js`: combine upstream opening/tracking lifecycle with named queues and a pre-load web resolver; remove superseded workarounds.
- `src/lib/auth-url.js`: translate legacy media-link token parameter names to `ApiKey`.
- `src/lib/titled-queue.js`: write safe M3U titles before appending queued items; remember the explicit queue so episode autoplay does not replace it.
- `src/lib/web-url-resolver.js`: resolve saved-server details links, fetch complete playlists, and choose audio/video stream routes.
- `src/lib/jellyfin-api.js`, `media-actions.js`, `playback-tracking.js`, `autoplay-manager.js`: upstream fixes plus modern authenticated URLs; autoplay request invalidation for manual queues.
- `src/lib/server-session-store.js`, `debug-log.js`, `src/global.js`: upstream session, logging, and global-window corrections.
- `src/ui/sidebar/`: retain the personal playlist tab, items, search chip, and top-positioned Play All controls; integrate upstream UI fixes, modern headers, pagination, stale-request guards, and escaping.
- `Info.json`, `package.json`, `pnpm-lock.yaml`, `.release-please-manifest.json`: upstream version/dependency updates, preserving fork identity.
- `README.md`, `CHANGELOG.md`, `help.html`, `pref.html`: updated usage/release information; `docs/pr-preparation/` contains this audit and the four draft bodies.
- `tests/*.test.cjs` and `tests/helpers.cjs`: 14 passing regression tests on the combined fork. Run `node --test tests/*.test.cjs`.

`pnpm run check` passed. IINA's bundled `iina-plugin pack .` produced a valid plugin archive. Test fixtures contain synthetic credentials only. Dependencies were installed with lifecycle scripts disabled.

## IINA loading

Installed IINA: **1.4.4**. The existing development symlink correctly points from `~/Library/Application Support/com.colliderli.iina/plugins/iina-jellyfin.iinaplugin-dev` to `/Users/alego/IINA_Plugins/iina-jellyfin`.

No reinstall/copy is required after edits, but this is **not live hot-reloading**: restart IINA to reload JavaScript and metadata, as described in the [IINA development guide](https://docs.iina.io/pages/dev-guide.html). IINA was not restarted or interrupted during this task.

After restarting, check the playlist tab, Play All while another item is playing, queued titles before playback, an episode queue with autoplay enabled, and a saved-server web details link. Actual UI playback remains unverified.

## Alternative check

For the requested full in-IINA browser, keeping this fork is the best fit among the projects inspected; no clearly superior drop-in replacement with verified Jellyfin 12 compatibility was established.

- [IINA Jellyfin Companion](https://github.com/yxwyoyoyo/iina-jellyfin-companion) is intentionally smaller: subtitle loading, progress reporting, and ordered season queues, with no login or library browser. Its README still requires a legacy `api_key` download URL, so it is not established as a Jellyfin 12-default-compatible replacement.
- [Jellyfin IINA Launcher](https://github.com/yxwyoyoyo/jellyfin-iina) adds an Open in IINA action on the server/web side. It complements a player plugin rather than replacing this sidebar.
- [Jellyfin MPV Shim](https://github.com/jellyfin/jellyfin-mpv-shim) is an alternative client, not an IINA plugin. Its [API notes](https://github.com/jellyfin/jellyfin-mpv-shim/blob/master/docs/jellyfin-api-notes.md) explicitly discuss Jellyfin 12 authorization changes. It would be a change of workflow, not a drop-in upgrade.

None of these alternatives was installed, and their end-to-end compatibility was not tested.
