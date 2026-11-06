'use strict';

function createPlaybackTitleOsd({ core, preferences, log }) {
  let fileGeneration = 0;
  let onResumeCompleted = null;

  function invalidate() {
    fileGeneration++;
    onResumeCompleted = null;
  }

  function beginFile(isJellyfin) {
    invalidate();
    const generation = fileGeneration;
    let shown = false;
    let resumed = false;
    let shownAfterResume = false;

    function showWhenReady() {
      if (
        !isJellyfin ||
        generation !== fileGeneration ||
        !preferences.get('show_playback_title_osd') ||
        (shown && (!resumed || shownAfterResume))
      ) {
        return;
      }
      try {
        const title = core.status?.title;
        // A slow metadata lookup can leave the stream URL here temporarily.
        if (typeof title !== 'string' || !title.trim() || /^https?:\/\//i.test(title.trim())) {
          return;
        }
        core.osd(title);
        shown = true;
        if (resumed) shownAfterResume = true;
      } catch (error) {
        log(`Could not display the playback title: ${error.message}`);
      }
    }

    onResumeCompleted = () => {
      resumed = true;
      showWhenReady();
    };
    showWhenReady();
    return showWhenReady;
  }

  function resumeCompleted() {
    if (onResumeCompleted) onResumeCompleted();
  }

  return { beginFile, invalidate, resumeCompleted };
}

module.exports = { createPlaybackTitleOsd };
