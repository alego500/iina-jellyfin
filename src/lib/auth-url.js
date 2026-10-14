'use strict';

// Jellyfin 12 disables legacy query/header authentication. Keep accepting old
// shared links, but send the supported ApiKey parameter to the server.
function normalizeJellyfinAuthUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\/[^/]+.*\/(?:Items|Videos|Audio)\//i.test(url)) {
    return url;
  }
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const hashStart = url.indexOf('#', queryStart);
  const end = hashStart === -1 ? url.length : hashStart;
  const query = url.slice(queryStart, end);
  // Do not shadow an explicitly supplied modern key with a legacy one.
  if (/[?&]apikey=/i.test(query)) return url;
  return (
    url.slice(0, queryStart) +
    query.replace(/([?&])(?:api_key|api-key|x-emby-token)=/gi, '$1ApiKey=') +
    url.slice(end)
  );
}

module.exports = { normalizeJellyfinAuthUrl };
