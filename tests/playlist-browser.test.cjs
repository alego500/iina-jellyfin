const assert = require('node:assert/strict');
const test = require('node:test');
const { loadSidebarMethods } = require('./helpers.cjs');
const path = 'src/ui/sidebar/lib/media-methods.js';
const server = { url: 'https://example.test/jellyfin', accessToken: 'test' };

test('playlist pagination preserves duplicates and server order across pages', async () => {
  const methods = loadSidebarMethods(path, { URLSearchParams });
  const offsets = [];
  const sidebar = { ...methods, currentServer: server, buildAuthorizationHeader: () => 'auth' };
  sidebar.getHttpClient = () => ({
    get: async (url) => {
      const offset = Number(new URL(url).searchParams.get('StartIndex'));
      offsets.push(offset);
      return {
        status: 200,
        data: {
          Items: Array.from({ length: offset === 0 ? 100 : 2 }, (_, i) => ({
            Id: String((offset + i) % 3),
          })),
          TotalRecordCount: 102,
        },
      };
    },
  });
  const result = await sidebar.fetchPlaylistPages(
    '/Playlists/test/Items',
    new URLSearchParams(),
    'playlistItems',
    sidebar.nextRequestId('playlistItems')
  );
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(result.length, 102);
  assert.equal(result[100].Id, '1');
});

test('a response received after changing servers is discarded', async () => {
  const methods = loadSidebarMethods(path, { URLSearchParams });
  const sidebar = { ...methods, currentServer: server, buildAuthorizationHeader: () => 'auth' };
  sidebar.getHttpClient = () => ({
    get: async () => {
      sidebar.currentServer = { ...server };
      return { data: { Items: [{ Id: 'old' }], TotalRecordCount: 1 } };
    },
  });
  assert.equal(
    await sidebar.fetchPlaylistPages(
      '/Items',
      new URLSearchParams(),
      'playlists',
      sidebar.nextRequestId('playlists')
    ),
    null
  );
});

test('playlist queue chooses audio/video streams and excludes containers', () => {
  const sidebar = { ...loadSidebarMethods(path), currentServer: server };
  const queue = sidebar.buildPlayableQueue([
    { Id: 'p', Type: 'Playlist', IsFolder: true },
    { Id: 'a', Type: 'Audio', Name: 'Song', Artists: ['Artist'] },
    {
      Id: 'e',
      Type: 'Episode',
      Name: 'Special',
      SeriesName: 'Show',
      ParentIndexNumber: 0,
      IndexNumber: 1,
    },
  ]);
  assert.equal(queue.length, 2);
  assert.match(queue[0].streamUrl, /\/Audio\/a\/stream\?static=true&ApiKey=test$/);
  assert.equal(queue[1].title, 'Show S00E01 - Special');
});

test('playlist rendering escapes server-provided text', () => {
  const nodes = [];
  const document = { createElement: () => ({ dataset: {}, addEventListener() {} }) };
  const sidebar = {
    ...loadSidebarMethods(path, { document }),
    ...loadSidebarMethods('src/ui/sidebar/lib/auth-server-methods.js', { document }),
    formatRuntime: () => '',
    getThumbnailUrl: () => '',
  };
  sidebar.renderPlaylistItems(
    [{ Id: 'x', Name: '<img src=x onerror=alert(1)>', Type: 'Audio', Artists: ['<script>'] }],
    { appendChild: (node) => nodes.push(node) }
  );
  assert.ok(!nodes[0].innerHTML.includes('<img src=x'));
  assert.match(nodes[0].innerHTML, /&lt;script&gt;/);
});
