const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');
const { buildM3uPlaylist, createTitledQueue } = loadModule('src/lib/titled-queue.js');
const items = [
  {
    title: 'Episode one\n#EXTINF:bad',
    streamUrl: 'https://server.test/Videos/1/stream?ApiKey=test',
  },
  { title: 'Episode two', streamUrl: 'https://server.test/Videos/2/stream?ApiKey=test' },
];

test('M3U carries every title, removes title newlines, and rejects injected URL entries', () => {
  const playlist = buildM3uPlaylist(items);
  assert.match(playlist, /#EXTINF:-1,Episode one #EXTINF:bad\nhttps:/);
  assert.equal(playlist.split('\n').filter((line) => line.startsWith('#EXTINF:')).length, 2);
  assert.throws(() =>
    buildM3uPlaylist([{ title: 'bad', streamUrl: 'https://server.test/\nfile:///etc/passwd' }])
  );
});

test('explicit queue protects revisits and its final item; a new selection clears it', () => {
  const calls = [];
  const queue = createTitledQueue({
    fs: { writeFileSync: (...args) => calls.push(['write', ...args]) },
    utils: { resolvePath: (value) => value },
    mpv: { command: (...args) => calls.push(['mpv', ...args]) },
    log: () => {},
  });
  queue.remember(items);
  assert.equal(queue.includes(items[1].streamUrl), true);
  assert.equal(queue.includes(items[0].streamUrl), true);
  assert.equal(queue.includes('https://elsewhere.test/Videos/1/stream'), false);
  queue.append(items.slice(1));
  assert.equal(calls[0][0], 'write');
  assert.equal(calls[1][1], 'loadlist');
  assert.equal(calls[1][2][1], 'append');
  queue.remember([]);
  assert.equal(queue.includes(items[0].streamUrl), false);
});
