# Upstream update and prepared pull requests

Prepared and published as draft pull requests on 2026-10-14 in the personal fork. No pull requests were submitted to the original project.

## Published drafts

- [#1 — Native IINA queue append](https://github.com/alego500/iina-jellyfin/pull/1)
- [#2 — Playlist browser, search, and Play All](https://github.com/alego500/iina-jellyfin/pull/2)
- [#3 — Direct Jellyfin web-link opening](https://github.com/alego500/iina-jellyfin/pull/3)
- [#4 — Legacy authenticated media-link normalization](https://github.com/alego500/iina-jellyfin/pull/4)

All four are drafts. PRs #1 and #4 target `codex/review-upstream-0.7.5`, an exact upstream v0.7.5 snapshot published in the personal fork. PRs #2 and #3 target #1's branch so their feature diffs remain separate. The repository's remote main branch was not changed.

## Updated fork

- Original project: [mhajder/iina-jellyfin](https://github.com/mhajder/iina-jellyfin).
- Personal fork: [alego500/iina-jellyfin](https://github.com/alego500/iina-jellyfin).
- Previous local main: `5b53630`, based on v0.7.2.
- Latest stable release and main: [v0.7.5](https://github.com/mhajder/iina-jellyfin/releases/tag/v0.7.5), published 2026-10-11, commit `b7a5191`.
- Integrated 26 upstream commits since v0.7.2.
- Preserved `Jellyfin by alego500`, `com.alego500.iina-jellyfin`, personal repository metadata, and the saved-settings namespace.
- Version values: `0.7.2 → 0.7.5` in Info.json, package.json, release manifest, and runtime client identity; Info.json `ghVersion: 12 → 15`.
- Development dependencies: ESLint `^10.8.1 → ^10.12.0`; Prettier `^3.9.6 → ^3.9.9`, with upstream's lockfile.
- Added upstream's sidebarTab declaration, required for the browser in IINA 1.5. The installed IINA version is 1.5.0.

## Upstream overlap

| Area                                   | Current upstream behavior                                                                       | Decision                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Jellyfin 12 authentication             | Modern headers and ApiKey transport, [PR #94](https://github.com/mhajder/iina-jellyfin/pull/94) | Adopt upstream; retire the broad authentication proposal                                                                           |
| Commas in queued titles                | Proper quoting in mpv options, [PR #123](https://github.com/mhajder/iina-jellyfin/pull/123)     | Recognize the bug is fixed upstream; keep native queue append as a separate implementation proposal                                |
| Current-file titles                    | Set before load, clear stale titles, share metadata requests                                    | Adopt upstream; run web-link resolution at priority 40 before upstream's priority-50 title hook                                    |
| Resume/progress                        | Preserve unplayed resume points, stop replaced items at their own positions                     | Adopt upstream and its tests                                                                                                       |
| Server matching and logins             | Normalize URL spellings while respecting proxy paths; consistent login/switch state             | Adopt upstream session logic; retain exact saved-base matching for the fork's connected-account reporting and web-link credentials |
| Sidebar and subtitles                  | IINA 1.5 tab support, current seasons, precise language matching, debug preference              | Adopt upstream                                                                                                                     |
| Playlist browser and web details links | Neither feature is implemented upstream                                                         | Preserve and prepare as separate feature proposals                                                                                 |
| Older incoming authenticated links     | Upstream generates modern URLs but does not rewrite incoming legacy token names                 | Prepare a smaller compatibility proposal                                                                                           |

The removed titled-queue experiment remains removed. No temporary M3U generation, title prefetch/warmup, or custom queue/autoplay suppression was restored. Standard upstream title and autoplay behavior is retained.

## Review branches

| Proposal                                                   | Branch                         | Review base                    | Tip       | Tests |
| ---------------------------------------------------------- | ------------------------------ | ------------------------------ | --------- | ----- |
| [Older media-link compatibility](01-legacy-media-links.md) | `codex/pr-legacy-media-links`  | `upstream/main` at `b7a5191`   | `e323666` | 75    |
| [Native queue append](02-native-queue-append.md)           | `codex/pr-native-queue-append` | `upstream/main` at `b7a5191`   | `3cc1a29` | 73    |
| [Feature: playlist browser](03-playlist-browser.md)        | `codex/pr-playlist-browser`    | `codex/pr-native-queue-append` | `44764b2` | 77    |
| [Feature: open web links](04-web-links.md)                 | `codex/pr-web-links`           | `codex/pr-native-queue-append` | `30cb933` | 80    |

The two feature branches are siblings; neither includes the other. They use the native queue proposal as a shared prerequisite. Legacy-link normalization is independent. The complete fork additionally retains personal branding, encoded token values, and its stricter reporting-server boundary.

Review each change against its listed base:

```sh
git diff upstream/main...codex/pr-native-queue-append
git diff codex/pr-native-queue-append...codex/pr-playlist-browser
git diff codex/pr-native-queue-append...codex/pr-web-links
git diff upstream/main...codex/pr-legacy-media-links
```

If these changes are later proposed to the original project, the prerequisite should land first, or the feature branches must be rebased to an agreed upstream queue implementation. Submitting the dependent branches directly against upstream main now would include the native queue commit. The five review branches have been pushed only to the personal fork.

Previous PR tips are preserved under `codex/archive-2026-10-14-pr-*`. The previous main is preserved as `codex/backup-before-upstream-0.7.5`. Historical commits remain recoverable.

## Files and verification

- `src/index.js`: updated upstream lifecycle/cache/title logic; retained native append, exact reporting scope, priority-10 legacy normalization, and priority-40 web resolution.
- `src/lib/`: updated upstream resume, subtitle, session, autoplay, authentication, and title behavior; retained auth-url and web-url-resolver helpers and encoded token values.
- `src/ui/sidebar/`: updated upstream login/season/debug behavior; retained playlist tab, search chip, paginated item views, escaped text, and Play All controls.
- `Info.json`, `package.json`, `pnpm-lock.yaml`, `.release-please-manifest.json`: version/dependency/sidebar updates; test command now includes upstream JavaScript and personal CommonJS tests.
- `tests/`: retained 72 upstream tests and 15 personal regressions, including web/title-hook integration. Duplicate older authentication tests were replaced by upstream's suite and focused legacy-link tests.
- `README.md`, `CHANGELOG.md`, `help.html`, `pref.html`, `docs/pr-preparation/`: current usage, upstream release information, and rewritten PR drafts.

The combined fork passes **87 tests** and lint/format checks. Each proposed branch also passed its full test suite. Dependencies were installed with lifecycle scripts disabled.

The development symlink still points from `~/Library/Application Support/com.colliderli.iina/plugins/iina-jellyfin.iinaplugin-dev` to `/Users/alego/IINA_Plugins/iina-jellyfin`. Restart IINA after the update to load the new JavaScript and sidebar metadata.

Native queue behavior was verified during the earlier September fix. No new IINA GUI playback or live Jellyfin server probe was performed for this October update. The current build still needs a manual check of the playlist tab, Play All, direct web links, and progress/resume in IINA 1.5.
