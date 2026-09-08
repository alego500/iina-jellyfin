const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule, loadSidebarMethods } = require('./helpers.cjs');
const { normalizeJellyfinAuthUrl } = loadModule('src/lib/auth-url.js');

test('old authenticated media links use ApiKey without losing query values or base paths', () => {
  const legacy =
    'https://example.test/jellyfin/Videos/123/stream?static=true&api_key=one%2Btwo#part';
  assert.equal(normalizeJellyfinAuthUrl(legacy), legacy.replace('api_key=', 'ApiKey='));
  assert.equal(normalizeJellyfinAuthUrl('/tmp/Items/a?api_key=x'), '/tmp/Items/a?api_key=x');
  assert.equal(
    normalizeJellyfinAuthUrl('https://example.test/web/#/details?id=123'),
    'https://example.test/web/#/details?id=123'
  );
  assert.equal(
    normalizeJellyfinAuthUrl('https://example.test/Items/a?ApiKey=new&api_key=old'),
    'https://example.test/Items/a?ApiKey=new&api_key=old'
  );
});

test('sidebar requests send a MediaBrowser token header and streams/artwork use ApiKey', async () => {
  const methods = loadSidebarMethods('src/ui/sidebar/lib/media-methods.js');
  const auth = loadSidebarMethods('src/ui/sidebar/lib/auth-server-methods.js');
  const sidebar = {
    ...methods,
    ...auth,
    clientIdentity: { deviceId: 'test-device', version: '0.7.2' },
    currentServer: { url: 'https://example.test/jellyfin', accessToken: 'one+two' },
  };
  assert.match(sidebar.buildAuthorizationHeader('one+two'), /^MediaBrowser .*Token="one\+two"$/);
  assert.equal(
    new URL(sidebar.buildStreamUrl({ Id: '123', Type: 'Audio' })).searchParams.get('ApiKey'),
    'one+two'
  );
  assert.equal(
    new URL(
      sidebar.getThumbnailUrl({ Id: '123', ImageTags: { Primary: 'tag' } }, 100)
    ).searchParams.get('ApiKey'),
    'one+two'
  );
  const requests = [];
  sidebar.getHttpClient = () => ({
    get: async (url, options) => {
      requests.push({ url, options });
      return { status: 401 };
    },
  });
  sidebar.updateServerStatus = () => {};
  await sidebar.connectToServer({ serverUrl: sidebar.currentServer.url, accessToken: 'one+two' });
  assert.equal(requests.length, 1);
  assert.match(requests[0].options.headers.Authorization, /Token="one\+two"/);
  assert.equal(requests[0].options.headers['X-Emby-Token'], undefined);
});
