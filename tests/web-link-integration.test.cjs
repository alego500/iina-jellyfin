const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');
const id = '12345678123412341234123456789abc';
const webUrl = `https://host/web/#/details?id=${id}`;

function setup(get) {
  const hooks = {};
  const events = {};
  const commands = [];
  const writes = [];
  const properties = { 'stream-open-filename': webUrl };
  const values = {
    jellyfin_servers: JSON.stringify([
      { id: 's', serverUrl: 'https://host', accessToken: 'test-token', userId: 'u' },
    ]),
    jellyfin_active_server_id: 's',
    jellyfin_device_id: 'test-device',
    autoplay_next_episode: true,
  };
  const iina = {
    core: { osd() {} },
    console,
    menu: { item() {}, addItem() {} },
    event: {
      on: (name, callback) => {
        events[name] = callback;
      },
    },
    http: { get },
    utils: { resolvePath: (path) => path },
    preferences: {
      get: (key) => values[key],
      set: (key, value) => {
        values[key] = value;
      },
      sync() {},
    },
    mpv: {
      addHook: (name, priority, callback) => {
        hooks[priority] = callback;
      },
      getString: (key) => properties[key],
      set: (key, value) => {
        properties[key] = value;
      },
      command: (name, args) => commands.push({ name, args }),
    },
    sidebar: {},
    standaloneWindow: {},
  };
  loadModule('src/index.js', {
    iina,
    require: (path) =>
      path === 'fs'
        ? { writeFileSync: (path, content) => writes.push({ path, content }) }
        : loadModule('src/' + path.slice(2)),
  });
  return { hooks, events, commands, writes, properties, iina };
}

test('web load hook resolves before continuing and appends only after the first load', async () => {
  let requests = 0;
  const state = setup(async () => ({
    data:
      ++requests === 1
        ? { Type: 'Playlist' }
        : {
            TotalRecordCount: 2,
            Items: [
              { Id: 'first', Type: 'Episode', Name: 'One' },
              { Id: 'second', Type: 'Audio', Name: 'Two' },
            ],
          },
  }));
  let continued = 0;
  await state.hooks[50](() => continued++);
  assert.equal(continued, 1);
  assert.match(state.properties['stream-open-filename'], /\/Videos\/first\/stream/);
  assert.equal(state.commands.length, 0);
  // IINA may report the original web URL, not mpv's overridden stream URL.
  state.events['iina.file-loaded'](webUrl);
  assert.equal(state.commands[0].name, 'loadlist');
  assert.equal(state.commands[0].args[1], 'append');
  assert.match(state.writes[0].content, /#EXTINF:-1,Two\nhttps:\/\/host\/Audio\/second/);
  assert.equal(
    requests,
    2,
    'explicit episode queue must not trigger automatic next-episode lookup'
  );
  state.events['iina.file-loaded'](
    'https://host/Audio/second/stream?static=true&ApiKey=test-token'
  );
  assert.equal(state.commands.length, 1, 'queue is appended once only');
});

test('web hook always continues even when the mpv property read fails', async () => {
  const state = setup(() => assert.fail('No request expected'));
  state.iina.mpv.getString = () => {
    throw new Error('player closed');
  };
  let continued = 0;
  await state.hooks[50](() => continued++);
  assert.equal(continued, 1);
});

test('web hook discards an asynchronous resolution when another file replaced it', async () => {
  let finish;
  const state = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let continued = 0;
  const loading = state.hooks[50](() => continued++);
  state.properties['stream-open-filename'] = 'file:///local/movie.mkv';
  finish({ data: { Id: id, Type: 'Movie', Name: 'Movie' } });
  await loading;
  assert.equal(continued, 1);
  assert.equal(state.properties['stream-open-filename'], 'file:///local/movie.mkv');
  assert.equal(state.commands.length, 0);
});
