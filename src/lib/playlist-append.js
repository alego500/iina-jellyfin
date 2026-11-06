'use strict';

function buildM3uPlaylist(items) {
  const lines = ['#EXTM3U'];
  for (const { streamUrl, title } of items) {
    if (!/^https?:\/\//i.test(streamUrl) || /[\0\r\n]/.test(streamUrl)) {
      throw new Error('Invalid playlist stream URL');
    }
    // M3U stores one title per line. Commas and Unicode need no escaping,
    // but line breaks must not become extra entries or playlist directives.
    const singleLineTitle = String(title || '')
      .replace(/[\0\r\n]+/g, ' ')
      .trim();
    if (singleLineTitle) lines.push(`#EXTINF:-1,${singleLineTitle}`);
    lines.push(streamUrl);
  }
  return `${lines.join('\n')}\n`;
}

function appendPlaylistItems(items, { mpv, playlist, useTitles, log }) {
  function appendUrls() {
    if (
      playlist.add(
        items.map((item) => item.streamUrl),
        -1
      ) === false
    ) {
      throw new Error('IINA could not append the playlist');
    }
  }

  if (!useTitles || !items.some((item) => item.title)) {
    appendUrls();
    return;
  }

  const content = buildM3uPlaylist(items);
  const before = mpv.getNumber('playlist-count');
  if (!Number.isSafeInteger(before) || before < 1) {
    throw new Error('Cannot verify the current playlist length');
  }

  try {
    // EXTINF supplies titles before playback on mpv 0.41, whose individual
    // playlist titles are read-only. memory:// avoids a credential-bearing file.
    // The command's argument array keeps the entire M3U as one literal string.
    mpv.command('loadlist', [`memory://${content}`, 'append']);
  } catch {
    // IINA's mpv.command normally returns no error status. Check the actual
    // length below, even when the bridge throws, before deciding to retry.
    log('Named playlist import failed; checking whether any entries were added');
  }

  const after = mpv.getNumber('playlist-count');
  if (after === before) {
    log('Named playlist import added no entries; appending URLs through IINA');
    appendUrls();
    return;
  }

  // An empty native batch reloads IINA's playlist model and posts its normal
  // UI notification without adding or moving entries. Raw mpv commands alone
  // can leave its displayed queue out of date.
  if (playlist.add([], -1) === false) {
    throw new Error('IINA could not refresh the named playlist');
  }
  if (after !== before + items.length) {
    // Never append the URLs again after a partial/uncertain import: that could
    // duplicate entries already added. Keep the current queue available.
    throw new Error('Named playlist import added an unexpected number of entries');
  }
}

module.exports = { buildM3uPlaylist, appendPlaylistItems };
