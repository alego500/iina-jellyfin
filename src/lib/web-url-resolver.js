'use strict';

// The plugin runs in JavaScriptCore, where browser URL APIs are not available.
function parseJellyfinWebUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(
    /^(https?:\/\/[^/?#]+(?:\/[^?#]*)?)\/web\/(?:index\.html)?#!?\/details\?([^#]*)$/i
  );
  if (!match) return null;
  const id = match[2].match(/(?:^|&)id=([^&]+)/i);
  if (!id) return null;
  try {
    const itemId = decodeURIComponent(id[1]);
    if (!/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(itemId)) return null;
    return { serverBase: match[1].replace(/\/+$/, ''), itemId };
  } catch {
    return null;
  }
}

function getPlaybackTitle(item) {
  const name = item.Name || 'Unknown Title';
  if (item.Type === 'Episode') {
    const season = String(item.ParentIndexNumber ?? '?').padStart(2, '0');
    const episode = String(item.IndexNumber ?? '?').padStart(2, '0');
    return `${item.SeriesName || 'Series'} S${season}E${episode} - ${name}`;
  }
  if (item.Type === 'Audio' && item.Artists?.length) return `${item.Artists.join(', ')} - ${name}`;
  return item.ProductionYear ? `${name} (${item.ProductionYear})` : name;
}

function createWebUrlResolver({
  http,
  buildJellyfinHeaders,
  fetchItemMetadata,
  loadStoredServers,
  getStoredJellyfinSession,
}) {
  async function resolve(url) {
    const parsed = parseJellyfinWebUrl(url);
    if (!parsed) return null;
    const active = getStoredJellyfinSession();
    const servers = [active, ...loadStoredServers()];
    // Match the entire saved base URL, including a reverse proxy path. Never
    // reuse a token merely because a link looks like a Jellyfin web page.
    const server = servers.find(
      (candidate) =>
        candidate?.accessToken &&
        String(candidate.serverUrl).replace(/\/+$/, '') === parsed.serverBase
    );
    if (!server) throw new Error('Sign in to this Jellyfin server in the browser first');
    const metadata = await fetchItemMetadata(parsed.serverBase, parsed.itemId, server.accessToken);
    let items = [metadata];
    if (metadata.Type === 'Playlist') {
      items = [];
      while (true) {
        const response = await http.get(
          `${parsed.serverBase}/Playlists/${parsed.itemId}/Items?UserId=${encodeURIComponent(server.userId || '')}&StartIndex=${items.length}&Limit=100`,
          {
            headers: buildJellyfinHeaders(server.accessToken),
          }
        );
        if ((response.status || response.statusCode) >= 400) {
          throw new Error('Playlist request failed');
        }
        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        if (!data || !Array.isArray(data.Items)) throw new Error('Invalid playlist response');
        items.push(...data.Items);
        if (
          data.Items.length === 0 ||
          items.length >= data.TotalRecordCount ||
          ((data.TotalRecordCount === null || data.TotalRecordCount === undefined) &&
            data.Items.length < 100)
        ) {
          break;
        }
      }
    }
    const queue = items
      .filter(
        (item) =>
          item?.Id &&
          !item.IsFolder &&
          ['Movie', 'Episode', 'Audio', 'Video', 'MusicVideo'].includes(item.Type)
      )
      .map((item) => ({
        itemId: item.Id,
        title: getPlaybackTitle(item),
        streamUrl: `${parsed.serverBase}/${item.Type === 'Audio' ? 'Audio' : 'Videos'}/${encodeURIComponent(item.Id)}/stream?static=true&ApiKey=${encodeURIComponent(server.accessToken)}`,
      }));
    if (!queue.length) throw new Error('This Jellyfin link contains no playable items');
    return queue;
  }
  return { resolve };
}

module.exports = { parseJellyfinWebUrl, getPlaybackTitle, createWebUrlResolver };
