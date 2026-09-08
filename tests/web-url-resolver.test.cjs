const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');
const { parseJellyfinWebUrl, createWebUrlResolver } = loadModule('src/lib/web-url-resolver.js');
const id = '12345678123412341234123456789abc';

test('web parser supports current and legacy details links including proxy paths', () => {
  for (const url of [
    `https://host/web/#/details?id=${id}`,
    `https://host/web/index.html#!/details?id=${id}`,
  ]) {
    assert.equal(parseJellyfinWebUrl(url).serverBase, 'https://host');
  }
  assert.equal(
    parseJellyfinWebUrl(`https://host/jellyfin/web/index.html#!/details?id=${id}&serverId=x`)
      .serverBase,
    'https://host/jellyfin'
  );
  for (const url of [
    'file:///web/#/details?id=x',
    `https://host/web/#/home?id=${id}`,
    'https://host/web/#/details?id=%2e%2e%2fUsers',
  ]) {
    assert.equal(parseJellyfinWebUrl(url), null);
  }
});

test('web resolver uses the active matching account and pages ordered mixed playlists', async () => {
  const server = {
    serverUrl: 'https://host/jellyfin',
    accessToken: 'active+token',
    userId: 'user',
  };
  const requests = [];
  const resolver = createWebUrlResolver({
    loadStoredServers: () => [{ ...server, accessToken: 'other-account' }],
    getStoredJellyfinSession: () => server,
    buildJellyfinHeaders: (token) => ({ Authorization: `MediaBrowser Token="${token}"` }),
    fetchItemMetadata: async (base, itemId, token) => {
      assert.equal(base, server.serverUrl);
      assert.equal(itemId, id);
      assert.equal(token, server.accessToken);
      return { Type: 'Playlist' };
    },
    http: {
      get: async (url, options) => {
        requests.push({ url, options });
        return {
          status: 200,
          data: {
            TotalRecordCount: 101,
            Items:
              requests.length === 1
                ? Array.from({ length: 100 }, () => ({
                    Id: 'a',
                    Type: 'Audio',
                    Name: 'Song',
                    Artists: ['Artist'],
                  }))
                : [
                    {
                      Id: 'b',
                      Type: 'Episode',
                      Name: 'Special',
                      SeriesName: 'Show',
                      ParentIndexNumber: 0,
                      IndexNumber: 1,
                    },
                  ],
          },
        };
      },
    },
  });
  const items = await resolver.resolve(`${server.serverUrl}/web/#/details?id=${id}`);
  assert.equal(items.length, 101);
  assert.match(requests[1].url, /StartIndex=100&Limit=100$/);
  assert.match(requests[0].options.headers.Authorization, /active\+token/);
  assert.equal(items[0].title, 'Artist - Song');
  assert.match(items[0].streamUrl, /\/Audio\/a\/stream\?static=true&ApiKey=active%2Btoken$/);
  assert.equal(items[100].title, 'Show S00E01 - Special');
});

test('web resolver never sends saved credentials to a different host or base path', async () => {
  const resolver = createWebUrlResolver({
    loadStoredServers: () => [{ serverUrl: 'https://host/jellyfin', accessToken: 'secret' }],
    getStoredJellyfinSession: () => null,
    fetchItemMetadata: () => assert.fail('Must not make an authenticated request'),
  });
  await assert.rejects(resolver.resolve(`https://host/other/web/#/details?id=${id}`), /Sign in/);
  await assert.rejects(resolver.resolve(`https://other/web/#/details?id=${id}`), /Sign in/);
  assert.equal(await resolver.resolve('https://host/movie.mp4'), null);
});
