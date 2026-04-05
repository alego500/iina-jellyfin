/**
 * IINA Jellyfin Plugin
 */

const fs = require('fs');

const { createDebugLogger } = require('./lib/debug-log.js');
const { createJellyfinApi } = require('./lib/jellyfin-api.js');
const { createServerSessionStore } = require('./lib/server-session-store.js');
const { createPlaybackTrackingManager } = require('./lib/playback-tracking.js');
const { createAutoplayManager } = require('./lib/autoplay-manager.js');
const { createMediaActionsManager } = require('./lib/media-actions.js');

const {
  core,
  console,
  menu,
  event,
  http,
  utils,
  preferences,
  mpv,
  sidebar,
  global,
  standaloneWindow,
  playlist,
} = iina;
let isReplacingPlayback = false; // Guard to prevent spurious stop reports during file switch
let pendingResolvedQueue = null;
let isHandlingLoadFailure = false;
let pendingPostLoadTaskId = 0;

const debugLog = createDebugLogger(preferences, console);

const {
  buildJellyfinHeaders,
  parseJellyfinUrl,
  isJellyfinUrl,
  fetchPlaybackInfo,
  fetchItemMetadata,
  secondsToTicks,
  ticksToSeconds,
} = createJellyfinApi({
  http,
  preferences,
  log: debugLog,
});

const {
  loadStoredServers,
  getActiveServerId,
  setActiveServerId,
  addOrUpdateServer,
  removeServer,
  switchActiveServer,
  storeJellyfinSession,
  clearJellyfinSession,
  getStoredJellyfinSession,
} = createServerSessionStore({
  preferences,
  sidebar,
  log: debugLog,
});

debugLog('Jellyfin Subtitles Plugin loaded');

const {
  startPlaybackTracking,
  stopPlaybackTracking,
  handlePlaybackPositionChange,
  handlePauseChange,
  markAsWatched,
  getCurrentPlaybackSession,
} = createPlaybackTrackingManager({
  core,
  http,
  preferences,
  buildJellyfinHeaders,
  fetchPlaybackInfo,
  fetchItemMetadata,
  secondsToTicks,
  ticksToSeconds,
  log: debugLog,
});

const { setupAutoplayForEpisode, resetForNewFile, clearQueuedFlag, isQueued } =
  createAutoplayManager({
    http,
    mpv,
    core,
    preferences,
    buildJellyfinHeaders,
    fetchItemMetadata,
    log: debugLog,
  });

const {
  setVideoTitleFromMetadata,
  downloadAllSubtitles,
  manualDownloadSubtitles,
  manualSetTitle,
  updateFromFileUrl,
} = createMediaActionsManager({
  core,
  http,
  utils,
  preferences,
  mpv,
  parseJellyfinUrl,
  isJellyfinUrl,
  fetchPlaybackInfo,
  fetchItemMetadata,
  log: debugLog,
});

/**
 * Handle file loaded event
 */
function onFileLoaded(fileUrl) {
  debugLog(`File loaded: ${fileUrl}`);

  if (pendingResolvedQueue) {
    debugLog('Processing pending resolved queue after file load', {
      loadedUrl: fileUrl,
      queueLength: pendingResolvedQueue.queueItems?.length || 0,
    });
    void appendPendingQueueItems(pendingResolvedQueue.queueItems, pendingResolvedQueue.queueTitle);
    pendingResolvedQueue = null;
  }

  // Stop any existing playback tracking from previous file
  stopPlaybackTracking();

  const jellyfinInfo = updateFromFileUrl(fileUrl);
  if (jellyfinInfo) {
    // Store session data for auto-login if enabled
    storeJellyfinSession(jellyfinInfo.serverBase, jellyfinInfo.apiKey);

    const taskId = ++pendingPostLoadTaskId;

    // Let playback settle before hitting Jellyfin with background metadata requests.
    setTimeout(async () => {
      if (taskId !== pendingPostLoadTaskId) {
        debugLog(`Skipping stale post-load Jellyfin tasks for: ${jellyfinInfo.itemId}`);
        return;
      }

      if (preferences.get('sync_playback_progress')) {
        debugLog(`Starting playback tracking for: ${jellyfinInfo.itemId}`);
        await startPlaybackTracking(jellyfinInfo.serverBase, jellyfinInfo.itemId, jellyfinInfo.apiKey);
      }

      if (taskId !== pendingPostLoadTaskId) {
        return;
      }

      if (preferences.get('set_video_title')) {
        debugLog(`Setting video title from metadata for: ${jellyfinInfo.itemId}`);
        await setVideoTitleFromMetadata(
          jellyfinInfo.serverBase,
          jellyfinInfo.itemId,
          jellyfinInfo.apiKey
        );
      }

      if (taskId !== pendingPostLoadTaskId) {
        return;
      }

      if (preferences.get('autoplay_next_episode')) {
        debugLog(`Setting up autoplay for episode (itemId): ${jellyfinInfo.itemId}`);
        resetForNewFile();
        await setupAutoplayForEpisode(jellyfinInfo.serverBase, jellyfinInfo.itemId, jellyfinInfo.apiKey);
      }

      if (taskId !== pendingPostLoadTaskId) {
        return;
      }

      if (preferences.get('auto_download_enabled')) {
        debugLog(`Auto-downloading subtitles for: ${jellyfinInfo.itemId}`);
        await downloadAllSubtitles(jellyfinInfo.serverBase, jellyfinInfo.itemId, jellyfinInfo.apiKey);
      } else {
        debugLog('Auto download disabled, but Jellyfin URL stored for manual download');
      }
    }, 250);
  }
}

/**
 * Show Jellyfin Browser - handles the case when no window is available
 */
function showJellyfinBrowser() {
  try {
    debugLog('Attempting to show Jellyfin browser');

    // Try to show sidebar directly first
    if (sidebar && sidebar.show) {
      sidebar.show();
      debugLog('Sidebar shown successfully');
      return;
    }
  } catch (error) {
    debugLog(`Direct sidebar.show() failed: ${error.message}`);

    // Check if we have stored session data that could be useful
    const sessionData = getStoredJellyfinSession();

    // Always open in standalone window when sidebar isn't available
    debugLog('Opening Jellyfin browser in standalone window');
    openJellyfinStandaloneWindow(sessionData);
  }
}

/**
 * Open Jellyfin browser in a standalone window
 */
function openJellyfinStandaloneWindow(sessionData) {
  try {
    debugLog('Creating standalone Jellyfin browser window');

    // Load the same sidebar HTML in standalone window
    standaloneWindow.loadFile('src/ui/sidebar/index.html');

    // Set window properties
    standaloneWindow.setFrame({ x: 100, y: 100, width: 400, height: 600 });
    standaloneWindow.setProperty('title', 'Jellyfin Browser');
    standaloneWindow.setProperty('resizable', true);
    standaloneWindow.setProperty('minimizable', true);

    // Set up message handlers for standalone window
    standaloneWindow.onMessage('get-session', () => {
      standaloneWindow.postMessage('session-data', sessionData);
    });

    standaloneWindow.onMessage('play-media', (data) => {
      handlePlayMedia(data);
      // Close standalone window after starting playback
      standaloneWindow.close();
    });

    standaloneWindow.onMessage('clear-session', () => {
      clearJellyfinSession();
    });

    standaloneWindow.onMessage('store-session', (data) => {
      if (data && data.serverUrl && data.accessToken) {
        const server = addOrUpdateServer({
          serverUrl: data.serverUrl,
          accessToken: data.accessToken,
          serverName: data.serverName || '',
          userId: data.userId || '',
          username: data.username || '',
        });
        if (server) {
          setActiveServerId(server.id);
          standaloneWindow.postMessage('servers-updated', {
            servers: loadStoredServers(),
            activeServerId: server.id,
          });
        }
      }
    });

    // Multi-server management messages
    standaloneWindow.onMessage('get-servers', () => {
      const servers = loadStoredServers();
      const activeServerId = getActiveServerId();
      standaloneWindow.postMessage('servers-list', { servers, activeServerId });
    });

    standaloneWindow.onMessage('remove-server', (data) => {
      if (data && data.serverId) {
        removeServer(data.serverId);
        // Also notify standalone window (removeServer only notifies sidebar)
        standaloneWindow.postMessage('servers-updated', {
          servers: loadStoredServers(),
          activeServerId: getActiveServerId(),
        });
      }
    });

    standaloneWindow.onMessage('switch-server', (data) => {
      if (data && data.serverId) {
        switchActiveServer(data.serverId);
      }
    });

    standaloneWindow.onMessage('open-external-url', (data) => {
      if (data && data.url) {
        debugLog(`Opening external URL from standalone: ${data.url}`);
        try {
          utils.open(data.url);
        } catch (error) {
          debugLog(`Failed to open external URL: ${error.message}`);
        }
      }
    });

    // Open the window
    standaloneWindow.open();

    // Send session data after a brief delay
    setTimeout(() => {
      // Send multi-server list (sidebar will auto-connect to active server)
      const servers = loadStoredServers();
      const activeServerId = getActiveServerId();
      standaloneWindow.postMessage('servers-list', { servers, activeServerId });
      // Also send legacy session for backward compatibility
      if (sessionData) {
        standaloneWindow.postMessage('session-available', sessionData);
      }
    }, 1000);

    debugLog('Standalone Jellyfin browser window opened successfully');
    if (sessionData) {
      core.osd(
        `Jellyfin Browser opened in standalone window\nServer: ${sessionData.serverUrl.replace(/^https?:\/\//, '')}`
      );
    } else {
      core.osd('Jellyfin Browser opened in standalone window\nPlease login to access your media');
    }
  } catch (error) {
    debugLog(`Failed to create standalone window: ${error.message}`);
  }
}

// Menu items
menu.addItem(menu.item('Download Jellyfin Subtitles', manualDownloadSubtitles));
menu.addItem(menu.item('Set Jellyfin Title', manualSetTitle));
menu.addItem(
  menu.item(
    'Show Jellyfin Browser',
    () => {
      showJellyfinBrowser();
    },
    { keyBinding: 'Cmd+Shift+J' }
  )
);

/**
 * Open media in a new IINA instance
 */
function openInNewInstance(streamUrl, title) {
  if (typeof global !== 'undefined' && global.postMessage) {
    debugLog('Requesting new player instance from global entry');

    // Listen for response from global entry
    const messageHandler = (name, data) => {
      if (name === 'player-created') {
        debugLog('New player instance created', {
          playerId: data?.playerId,
          title: data?.title,
          url: data?.url,
        });
        core.osd(`Opened in new window: ${data.title}`);
      } else if (name === 'player-creation-failed') {
        debugLog('Failed to create new player instance: ' + data.error);
        core.osd('Failed to open new window - opening in current window');
        // Fallback to current window
        core.open(streamUrl);
      }
    };

    // Set up temporary listener (IINA doesn't have off() so we use this pattern)
    const originalHandler = global.onMessage;
    global.onMessage = (name, callback) => {
      if (name === 'player-created' || name === 'player-creation-failed') {
        return messageHandler(name, callback);
      }
      return originalHandler?.call(global, name, callback);
    };

    // Request new instance creation
    global.postMessage('create-player', { url: streamUrl, title: title });

    // Clean up listener after 5 seconds
    setTimeout(() => {
      global.onMessage = originalHandler;
    }, 5000);
  } else {
    debugLog('Global entry not available, opening in current window');
    core.open(streamUrl);
  }
}

function sanitizePlaylistTitle(title) {
  return (
    String(title || 'Unknown Title')
      .replace(/[\r\n]+/g, ' ')
      .trim() || 'Unknown Title'
  );
}

function buildM3uPlaylist(queueItems) {
  const lines = ['#EXTM3U'];

  queueItems.forEach((item) => {
    lines.push(`#EXTINF:-1,${sanitizePlaylistTitle(item.title)}`);
    lines.push(item.streamUrl);
  });

  return `${lines.join('\n')}\n`;
}

function parseJellyfinWebUrl(url) {
  try {
    const normalizedUrl = String(url || '').trim();
    const match = normalizedUrl.match(/^(https?:\/\/[^/]+)(\/web\/[^#?]*)(#[^?]*\?[^#]*)?$/);
    if (!match) {
      return null;
    }

    const serverBase = match[1];
    const pathname = match[2] || '';
    const hash = match[3] || '';

    if (!pathname.startsWith('/web/')) {
      return null;
    }

    const route = hash.replace(/^#!/, '').replace(/^#/, '');
    if (!route) {
      return null;
    }

    const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
    const [routePath, routeQuery = ''] = normalizedRoute.split('?');
    const params = parseQueryString(routeQuery);
    const itemId = params.id;

    if (routePath !== '/details' || !itemId) {
      return null;
    }

    return {
      serverBase,
      itemId,
      routePath,
    };
  } catch (error) {
    debugLog(`Failed to parse Jellyfin web URL: ${error.message}`);
    return null;
  }
}

function parseQueryString(queryString) {
  return String(queryString || '')
    .split('&')
    .filter(Boolean)
    .reduce((params, pair) => {
      const separatorIndex = pair.indexOf('=');
      const rawKey = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
      const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';

      try {
        const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
        const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
        if (key) {
          params[key] = value;
        }
      } catch (error) {
        debugLog(`Failed to parse query parameter "${pair}": ${error.message}`);
      }

      return params;
    }, {});
}

function buildQueryString(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join('&');
}

function findStoredServerAuth(serverBase) {
  const normalizedServerBase = String(serverBase || '').replace(/\/$/, '');
  const storedServers = loadStoredServers();

  return (
    storedServers.find((server) => server.serverUrl.replace(/\/$/, '') === normalizedServerBase) || null
  );
}

function getQueueItemTitle(item) {
  if (!item) {
    return 'Unknown Title';
  }

  if (item.Type === 'Episode' && item.SeriesName) {
    const season = Number(item.ParentIndexNumber);
    const episode = Number(item.IndexNumber);
    let resolvedTitle = item.SeriesName;

    if (Number.isFinite(season) && Number.isFinite(episode)) {
      resolvedTitle += ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    }

    if (item.Name) {
      resolvedTitle += ` - ${item.Name}`;
    }

    return resolvedTitle;
  }

  if (item.Type === 'Movie' && item.ProductionYear) {
    return `${item.Name || 'Unknown Title'} (${item.ProductionYear})`;
  }

  if (item.Type === 'Audio') {
    const artist = item.AlbumArtist || item.Artists?.join(', ') || '';
    if (artist && item.Name) {
      return `${artist} - ${item.Name}`;
    }
  }

  return item.Name || 'Unknown Title';
}

function buildStreamUrl(serverBase, itemId, apiKey) {
  return `${serverBase}/Items/${itemId}/Download?api_key=${encodeURIComponent(apiKey)}`;
}

function buildPlayableQueue(items, serverBase, apiKey) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items
    .filter(
      (item) =>
        item &&
        item.Id &&
        !item.IsFolder &&
        !['Playlist', 'Series', 'MusicAlbum', 'BoxSet', 'CollectionFolder'].includes(item.Type)
    )
    .map((item) => ({
      itemId: item.Id,
      itemType: item.Type,
      serverBase,
      title: getQueueItemTitle(item),
      streamUrl: buildStreamUrl(serverBase, item.Id, apiKey),
    }));
}

async function fetchPlaylistQueue(serverBase, playlistId, accessToken, userId) {
  const queryString = buildQueryString({
    fields: 'Path,MediaSources,Overview,ProductionYear,IndexNumber,ParentIndexNumber,SeriesName',
    userId,
  });

  const response = await http.get(`${serverBase}/Playlists/${playlistId}/Items?${queryString}`, {
    headers: buildJellyfinHeaders(accessToken, {
      Accept: 'application/json',
      'X-Emby-Token': accessToken,
    }),
  });

  const items = response?.data?.Items || [];
  return buildPlayableQueue(items, serverBase, accessToken);
}

async function resolveJellyfinOpenUrl(url) {
  if (!url) {
    return null;
  }

  debugLog(`Attempting to resolve Jellyfin open URL: ${url}`);
  const parsedWebUrl = parseJellyfinWebUrl(url);
  if (!parsedWebUrl) {
    debugLog(`URL did not match Jellyfin web details format: ${url}`);
    return null;
  }

  const storedServer = findStoredServerAuth(parsedWebUrl.serverBase);
  if (!storedServer?.accessToken) {
    debugLog(`No stored Jellyfin auth found for ${parsedWebUrl.serverBase}`);
    core.osd('No Jellyfin login found for this server');
    return null;
  }

  const metadata = await fetchItemMetadata(
    parsedWebUrl.serverBase,
    parsedWebUrl.itemId,
    storedServer.accessToken
  );

  if (!metadata?.Id || !metadata?.Type) {
    return null;
  }

  if (metadata.Type === 'Playlist') {
    const queueItems = await fetchPlaylistQueue(
      parsedWebUrl.serverBase,
      metadata.Id,
      storedServer.accessToken,
      storedServer.userId
    );

    if (queueItems.length === 0) {
      core.osd('Playlist has no playable items');
      return null;
    }

    return {
      resolvedUrl: queueItems[0].streamUrl,
      title: queueItems[0].title || metadata.Name || 'Playlist',
      queueItems,
      queueTitle: metadata.Name || 'Playlist',
    };
  }

  if (['Movie', 'Episode', 'Audio', 'MusicVideo', 'Video'].includes(metadata.Type)) {
    return {
      resolvedUrl: buildStreamUrl(parsedWebUrl.serverBase, metadata.Id, storedServer.accessToken),
      title: getQueueItemTitle(metadata),
    };
  }

  core.osd(`Unsupported Jellyfin item type: ${metadata.Type}`);
  return null;
}

async function loadQueueInCurrentWindow(queueItems, title) {
  if (!queueItems || queueItems.length === 0) {
    throw new Error('Queue is empty');
  }

  if (getCurrentPlaybackSession()) {
    isReplacingPlayback = true;
  }

  try {
    if (playlist && typeof playlist.clear === 'function') {
      playlist.clear();
    }
    clearQueuedFlag();
  } catch (clearError) {
    debugLog(`Could not clear playlist before opening queue: ${clearError.message}`);
  }

  const tempPlaylistPath = utils.resolvePath(
    `@tmp/jellyfin_queue_${Date.now()}_${Math.floor(Math.random() * 100000)}.m3u8`
  );
  const shouldBootstrapWindow = Boolean(core?.status?.idle);
  const titledQueue = queueItems;

  try {
    fs.writeFileSync(tempPlaylistPath, buildM3uPlaylist(titledQueue), 'utf8');
    if (shouldBootstrapWindow) {
      debugLog(`Player is idle, opening queue playlist via core.open: ${tempPlaylistPath}`);
      core.open(tempPlaylistPath);
    } else {
      mpv.command('loadlist', [tempPlaylistPath, 'replace']);
    }
  } catch (error) {
    debugLog(`Failed to load titled playlist file: ${error.message}`);
    titledQueue.forEach((item, index) => {
      const useCoreOpenForFirstItem = shouldBootstrapWindow && index === 0;
      const action = index === 0 ? 'replace' : 'append';
      const itemTitle = item.title || (index === 0 ? title : null);
      if (useCoreOpenForFirstItem) {
        debugLog(`Falling back to core.open for first queue item: ${item.streamUrl}`);
        core.open(item.streamUrl);
      } else {
        const args = [item.streamUrl, action];
        if (itemTitle) {
          args.push('-1', `force-media-title=${itemTitle}`);
        }
        mpv.command('loadfile', args);
      }
    });
  }
}

async function appendPendingQueueItems(queueItems, title) {
  if (!Array.isArray(queueItems) || queueItems.length <= 1) {
    return;
  }

  try {
    const remainingItems = queueItems.slice(1);
    const tempPlaylistPath = utils.resolvePath(
      `@tmp/jellyfin_open_url_queue_${Date.now()}_${Math.floor(Math.random() * 100000)}.m3u8`
    );
    fs.writeFileSync(tempPlaylistPath, buildM3uPlaylist(remainingItems), 'utf8');
    mpv.command('loadlist', [tempPlaylistPath, 'append']);
    debugLog(
      `Appended ${remainingItems.length} queue item(s) via titled playlist after resolving open URL`
    );
  } catch (error) {
    debugLog(`Failed appending pending queue items via loadlist: ${error.message}`);
    try {
      for (let index = 1; index < queueItems.length; index++) {
        const item = queueItems[index];
        const args = [item.streamUrl, 'append'];
        const itemTitle = item.title || (index === 1 ? title : null);
        if (itemTitle) {
          args.push('-1', `force-media-title=${itemTitle}`);
        }
        mpv.command('loadfile', args);
      }
      debugLog(`Fallback appended ${queueItems.length - 1} queue item(s) with loadfile`);
    } catch (fallbackError) {
      debugLog(`Failed fallback append of pending queue items: ${fallbackError.message}`);
    }
  }
}

function playResolvedOpen(resolvedOpen) {
  if (!resolvedOpen?.resolvedUrl) {
    return;
  }

  handlePlayMedia({
    streamUrl: resolvedOpen.resolvedUrl,
    title: resolvedOpen.title,
    queueItems: resolvedOpen.queueItems,
  });
}

/**
 * Handle media playback requests from sidebar
 */
async function handlePlayMedia(message) {
  debugLog('HANDLE PLAY MEDIA CALLED');
  debugLog('handlePlayMedia called with message', {
    title: message?.title,
    streamUrl: message?.streamUrl,
    queueLength: message?.queueItems?.length,
  });
  const { streamUrl, title, queueItems } = message;
  debugLog(`Opening media: ${title} - ${streamUrl}`);

  try {
    const openInNewWindow = preferences.get('open_in_new_window');
    debugLog('open_in_new_window preference: ' + openInNewWindow);
    const normalizedQueue =
      Array.isArray(queueItems) && queueItems.length > 0
        ? queueItems.filter((item) => item && item.streamUrl)
        : null;

    if (openInNewWindow && normalizedQueue && normalizedQueue.length > 1) {
      debugLog('Playlist queue requested with open_in_new_window enabled, using current window');
      core.osd(`Opening playlist in current window: ${title}`);
      await loadQueueInCurrentWindow(normalizedQueue, title);
    } else if (openInNewWindow) {
      debugLog('Opening media in new instance: ' + streamUrl);
      core.osd(`Opening in new window: ${title}`);
      openInNewInstance(streamUrl, title);
    } else {
      debugLog('Opening media in current window: ' + streamUrl);
      core.osd(`Opening: ${title}`);
      if (normalizedQueue && normalizedQueue.length > 1) {
        await loadQueueInCurrentWindow(normalizedQueue, title);
      } else {
        // Set replacement guard so end-file handler doesn't send spurious stop
        if (getCurrentPlaybackSession()) {
          isReplacingPlayback = true;
        }

        // Clear any previous playlist entries to prevent stale titles
        try {
          if (playlist && typeof playlist.clear === 'function') {
            playlist.clear();
          }
          // Reset autoplay state when starting new playback
          clearQueuedFlag();
        } catch (clearError) {
          debugLog(`Could not clear playlist before opening: ${clearError.message}`);
        }

        // Use mpv loadfile with force-media-title to set the title atomically
        // This prevents the stale title bug where the old title persists until
        // the async setVideoTitleFromMetadata call completes
        if (title) {
          try {
            mpv.command('loadfile', [streamUrl, 'replace', '-1', `force-media-title=${title}`]);
          } catch (error) {
            debugLog(`mpv loadfile with title failed: ${error.message}, falling back to core.open`);
            isReplacingPlayback = false;
            core.open(streamUrl);
          }
        } else {
          core.open(streamUrl);
        }
      }
    }

    debugLog('Successfully initiated media opening: ' + streamUrl);
  } catch (error) {
    debugLog('Error opening media: ' + error);
    core.osd('Failed to open media');

    // Fallback: copy to clipboard as backup
    try {
      if (typeof core !== 'undefined' && core.setClipboard) {
        core.setClipboard(streamUrl);
        core.osd('Error opening - URL copied to clipboard');
      } else if (typeof utils !== 'undefined' && utils.setClipboard) {
        utils.setClipboard(streamUrl);
        core.osd('Error opening - URL copied to clipboard');
      } else {
        core.osd('Failed to open - check console for URL');
      }
    } catch (clipboardError) {
      debugLog('Both open and clipboard failed: ' + clipboardError);
      core.osd('Failed to open media - check console');
    }
  }
}

// Event handlers
mpv.addHook('on_load', 50, async (next) => {
  try {
    const currentUrl = mpv.getString('stream-open-filename');
    debugLog(`on_load hook received URL: ${currentUrl}`);
    const resolvedOpen = await resolveJellyfinOpenUrl(currentUrl);

    if (resolvedOpen?.resolvedUrl) {
      debugLog(`Resolved Jellyfin web URL to playable target: ${resolvedOpen.resolvedUrl}`);
      pendingResolvedQueue =
        Array.isArray(resolvedOpen.queueItems) && resolvedOpen.queueItems.length > 1
          ? {
              queueItems: resolvedOpen.queueItems,
              queueTitle: resolvedOpen.queueTitle || resolvedOpen.title || 'Playlist',
            }
          : null;
      mpv.set('stream-open-filename', resolvedOpen.resolvedUrl);
      if (resolvedOpen.title) {
        try {
          mpv.set('force-media-title', resolvedOpen.title);
        } catch (titleError) {
          debugLog(`Could not set media title during on_load: ${titleError.message}`);
        }
      }
    }
  } catch (error) {
    debugLog(`Failed to resolve Jellyfin open URL: ${error.message}`);
  }

  next();
});

mpv.addHook('on_load_fail', 50, async (next) => {
  try {
    if (isHandlingLoadFailure) {
      next();
      return;
    }

    const failedUrl = mpv.getString('stream-open-filename');
    debugLog(`on_load_fail hook received URL: ${failedUrl}`);
    const resolvedOpen = await resolveJellyfinOpenUrl(failedUrl);

    if (resolvedOpen?.resolvedUrl) {
      isHandlingLoadFailure = true;
      try {
        debugLog(`Recovering failed Jellyfin web URL load via handlePlayMedia: ${resolvedOpen.resolvedUrl}`);
        playResolvedOpen(resolvedOpen);
      } finally {
        isHandlingLoadFailure = false;
      }
    }
  } catch (error) {
    debugLog(`Failed to recover Jellyfin open URL after load failure: ${error.message}`);
  }

  next();
});

event.on('iina.file-loaded', onFileLoaded);

// Playback tracking events for Jellyfin progress sync
event.on('mpv.time-pos.changed', handlePlaybackPositionChange);

// Pause/unpause state sync
event.on('mpv.pause.changed', handlePauseChange);

// Handle file ending (includes both natural end and replacement)
event.on('mpv.end-file', () => {
  const queuedForAutoplay = isQueued();
  debugLog(
    'mpv.end-file triggered, isReplacingPlayback=' +
      isReplacingPlayback +
      ', autoplayQueued=' +
      queuedForAutoplay
  );
  if (isReplacingPlayback) {
    // File is being replaced (e.g. episode transition) — don't send stop report
    debugLog('File replacement in progress, skipping stop report');
    isReplacingPlayback = false;
    return;
  }
  if (queuedForAutoplay) {
    // Next episode is queued via insert-next — mpv will auto-advance
    debugLog('Autoplay queued, mpv will play next episode — skipping stop cleanup');
    // Reset for the next cycle (setupAutoplayForEpisode will re-set these)
    clearQueuedFlag();
    return;
  }
  stopPlaybackTracking();
});

// Handle EOF reached — mark as watched if near end
event.on('mpv.eof-reached', () => {
  debugLog('End of file reached (eof-reached)');
  const playbackSession = getCurrentPlaybackSession();
  if (playbackSession && playbackSession.itemId) {
    markAsWatched(playbackSession.serverBase, playbackSession.itemId, playbackSession.apiKey);
  }
});

// Stop tracking when window closes
event.on('iina.window-will-close', () => {
  debugLog('Window closing, stopping playback tracking');
  stopPlaybackTracking();
});

// Ensure we report stop on app termination
event.on('iina.application-will-terminate', () => {
  debugLog('Application terminating, stopping playback tracking');
  stopPlaybackTracking();
});

// Initialize sidebar when window is loaded
event.on('iina.window-loaded', () => {
  sidebar.loadFile('src/ui/sidebar/index.html');

  // Set up message handler for sidebar playback requests
  sidebar.onMessage('play-media', handlePlayMedia);

  // Handle session requests from sidebar (backward compatible)
  sidebar.onMessage('get-session', () => {
    const sessionData = getStoredJellyfinSession();
    sidebar.postMessage('session-data', sessionData);
  });

  // Handle session clear requests from sidebar
  sidebar.onMessage('clear-session', () => {
    clearJellyfinSession();
  });

  // Handle session storage requests from sidebar (manual login)
  sidebar.onMessage('store-session', (data) => {
    if (data && data.serverUrl && data.accessToken) {
      const server = addOrUpdateServer({
        serverUrl: data.serverUrl,
        accessToken: data.accessToken,
        serverName: data.serverName || '',
        userId: data.userId || '',
        username: data.username || '',
      });
      if (server) {
        setActiveServerId(server.id);
        // Send back updated server list
        sidebar.postMessage('servers-updated', {
          servers: loadStoredServers(),
          activeServerId: server.id,
        });
      }
    }
  });

  // Multi-server management messages
  sidebar.onMessage('get-servers', () => {
    const servers = loadStoredServers();
    const activeServerId = getActiveServerId();
    sidebar.postMessage('servers-list', { servers, activeServerId });
  });

  sidebar.onMessage('remove-server', (data) => {
    if (data && data.serverId) {
      removeServer(data.serverId);
    }
  });

  sidebar.onMessage('switch-server', (data) => {
    if (data && data.serverId) {
      switchActiveServer(data.serverId);
    }
  });

  // Handle external URL opening requests from sidebar
  sidebar.onMessage('open-external-url', (data) => {
    if (data && data.url) {
      debugLog(`Opening external URL: ${data.url}`);
      try {
        const success = utils.open(data.url);
        if (success) {
          debugLog('Successfully opened URL in browser');
          if (data.title) {
            core.osd(`Opened ${data.title} in browser`);
          } else {
            core.osd('Opened Jellyfin page in browser');
          }
        } else {
          throw new Error('utils.open returned false');
        }
      } catch (error) {
        debugLog(`Failed to open external URL: ${error.message}`);
        core.osd('Failed to open Jellyfin page in browser');
        debugLog(`URL that failed to open: ${data.url}`);
      }
    } else {
      debugLog('Invalid open-external-url message - missing URL');
    }
  });

  // Also expose a global method for sidebar communication
  global.playMedia = (streamUrl, title) => {
    debugLog('Global playMedia called with:', streamUrl, title);
    handlePlayMedia({ streamUrl, title });
  };

  // Send initial server data to sidebar after a brief delay
  setTimeout(() => {
    const servers = loadStoredServers();
    const activeServerId = getActiveServerId();
    if (servers.length > 0) {
      sidebar.postMessage('servers-list', { servers, activeServerId });
    }
    // Also send backward compatible session-available for auto-login
    const sessionData = getStoredJellyfinSession();
    if (sessionData) {
      sidebar.postMessage('session-available', sessionData);
    }
  }, 500);
});
