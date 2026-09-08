'use strict';

function buildM3uPlaylist(items) {
  const lines = ['#EXTM3U'];
  for (const item of items) {
    if (!/^https?:\/\//i.test(item.streamUrl) || /[\r\n]/.test(item.streamUrl)) {
      throw new Error('Invalid playlist stream URL');
    }
    const title = String(item.title || 'Unknown Title')
      .replace(/[\r\n]+/g, ' ')
      .trim();
    lines.push(`#EXTINF:-1,${title || 'Unknown Title'}`, item.streamUrl);
  }
  return `${lines.join('\n')}\n`;
}

function createTitledQueue({ fs, utils, mpv, log }) {
  let generation = 0;
  let items = [];

  function remember(queueItems) {
    // Keep membership until playback leaves this queue, including revisits and
    // the last episode. Autoplay must not replace a user-selected sequence.
    items = queueItems.map((item) => item.streamUrl);
    generation++;
  }

  function includes(fileUrl) {
    const match = (url) => {
      // IINA may percent-encode the query when emitting file-loaded.
      try {
        return decodeURI(String(url || ''));
      } catch {
        return String(url || '');
      }
    };
    return items.some((url) => match(url) === match(fileUrl));
  }

  function append(queueItems) {
    const path = utils.resolvePath(`@tmp/jellyfin_queue_${Date.now()}_${++generation}.m3u8`);
    // EXTINF names are playlist metadata, unlike force-media-title which only
    // becomes effective when an entry starts playing.
    fs.writeFileSync(path, buildM3uPlaylist(queueItems), 'utf8');
    try {
      mpv.command('loadlist', [path, 'append']);
    } catch (error) {
      log(`Could not load named playlist: ${error.message}`);
      throw error;
    }
  }

  return { remember, includes, append };
}

module.exports = { buildM3uPlaylist, createTitledQueue };
