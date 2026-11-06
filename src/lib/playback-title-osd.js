'use strict';

function createPlaybackTitleOsd({ core, preferences, log }) {
  let fileGeneration = 0;

  function invalidate() {
    fileGeneration++;
  }

  function beginFile(isJellyfin) {
    const generation = ++fileGeneration;
    let shown = false;

    function showWhenReady() {
      if (
        !isJellyfin ||
        shown ||
        generation !== fileGeneration ||
        !preferences.get('show_playback_title_osd')
      ) {
        return;
      }
      try {
        const title = core.status?.title;
        // Until the metadata is ready, IINA can return the stream URL here.
        // Wait for the title update instead of repeating that URL on screen.
        if (typeof title !== 'string' || !title.trim() || /^https?:\/\//i.test(title.trim())) {
          return;
        }
        core.osd(`Playing: ${title}`);
        shown = true;
      } catch (error) {
        log(`Could not display the playback title: ${error.message}`);
      }
    }

    // A browser/pre-load title is already available when file-loaded fires.
    // Return the same guarded callback for a later metadata result as well.
    showWhenReady();
    return showWhenReady;
  }

  return { beginFile, invalidate };
}

module.exports = { createPlaybackTitleOsd };
