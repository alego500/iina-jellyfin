const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');
const { buildM3uPlaylist, appendPlaylistItems } = loadModule('src/lib/playlist-append.js');

const items = [
  { streamUrl: 'https://host/Videos/a/stream?ApiKey=test-token', title: 'Hello, Goodbye — Æøå 🎬' },
  { streamUrl: 'https://host/Audio/b/stream?ApiKey=test-token', title: 'Two\r\n#EXTM3U\0lines' },
  { streamUrl: 'https://host/Videos/a/stream?ApiKey=test-token', title: 'Repeated item' },
];

function setup({ added = items.length, throwAfterImport = false, refreshFails = false } = {}) {
  let count = 1;
  const calls = [];
  return {
    calls,
    mpv: {
      getNumber: () => count,
      command(name, args) {
        calls.push({ name, args });
        count += added;
        if (throwAfterImport) throw new Error('bridge failed');
      },
    },
    playlist: {
      add(urls, at) {
        calls.push({ name: 'native-add', urls: Array.from(urls), at });
        count += urls.length;
        return !refreshFails;
      },
    },
    useTitles: true,
    log() {},
  };
}

test('M3U preserves punctuation, Unicode, URL credentials, order and duplicates', () => {
  assert.equal(
    buildM3uPlaylist(items),
    '#EXTM3U\n' +
      '#EXTINF:-1,Hello, Goodbye — Æøå 🎬\n' +
      `${items[0].streamUrl}\n` +
      '#EXTINF:-1,Two #EXTM3U lines\n' +
      `${items[1].streamUrl}\n` +
      '#EXTINF:-1,Repeated item\n' +
      `${items[2].streamUrl}\n`
  );
  assert.equal(
    buildM3uPlaylist([{ streamUrl: items[0].streamUrl }]),
    `#EXTM3U\n${items[0].streamUrl}\n`
  );
});

test('M3U rejects URL line injection, NULs and non-HTTP resources', () => {
  for (const streamUrl of ['https://host/a\nhttps://evil/b', 'https://host/a\0b', 'file:///a']) {
    assert.throws(() => buildM3uPlaylist([{ streamUrl, title: 'Title' }]), /Invalid playlist/);
  }
});

test('named append imports in memory then refreshes IINA without appending twice', () => {
  const state = setup();
  appendPlaylistItems(items, state);
  assert.equal(state.calls[0].name, 'loadlist');
  assert.deepEqual(Array.from(state.calls[0].args), [
    `memory://${buildM3uPlaylist(items)}`,
    'append',
  ]);
  assert.deepEqual(state.calls[1], { name: 'native-add', urls: [], at: -1 });
  assert.equal(state.calls.length, 2);
});

test('disabled titles and queues without names use native URL append', () => {
  const disabled = setup();
  disabled.useTitles = false;
  appendPlaylistItems(items, disabled);
  assert.deepEqual(disabled.calls, [
    { name: 'native-add', urls: items.map((item) => item.streamUrl), at: -1 },
  ]);

  const untitled = setup();
  appendPlaylistItems([{ streamUrl: items[0].streamUrl }], untitled);
  assert.equal(untitled.calls.length, 1);
  assert.equal(untitled.calls[0].name, 'native-add');
});

test('a silently rejected or throwing import falls back only when no entries were added', () => {
  for (const throwAfterImport of [false, true]) {
    const state = setup({ added: 0, throwAfterImport });
    appendPlaylistItems(items, state);
    assert.deepEqual(state.calls[1], {
      name: 'native-add',
      urls: items.map((item) => item.streamUrl),
      at: -1,
    });
    assert.equal(state.calls.length, 2);
  }
});

test('partial imports, late bridge failures and refresh failures never duplicate the queue', () => {
  const partial = setup({ added: 1 });
  assert.throws(() => appendPlaylistItems(items, partial), /unexpected number/);
  assert.deepEqual(partial.calls[1].urls, []);

  const lateFailure = setup({ throwAfterImport: true });
  appendPlaylistItems(items, lateFailure);
  assert.deepEqual(lateFailure.calls[1].urls, []);

  const refreshFailure = setup({ refreshFails: true });
  assert.throws(() => appendPlaylistItems(items, refreshFailure), /refresh/);
  assert.deepEqual(refreshFailure.calls[1].urls, []);
});
