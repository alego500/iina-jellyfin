const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');
const id = '12345678123412341234123456789abc';
const webUrl = `https://host/web/#/details?id=${id}`;

function setup(get) {
  const hooks = {};
  const events = {};
  const commands = [];
  const appended = [];
  const sidebarHandlers = {};
  const properties = { 'stream-open-filename': webUrl };
  const values = {
    jellyfin_servers: JSON.stringify([
      { id: 's', serverUrl: 'https://host', accessToken: 'test-token', userId: 'u' },
    ]),
    jellyfin_active_server_id: 's',
    jellyfin_device_id: 'test-device',
    autoplay_next_episode: false,
  };
  const iina = {
    core: {
      osd() {},
      open(url) {
        properties['stream-open-filename'] = url;
      },
    },
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
    playlist: {
      add: (urls, at) => {
        appended.push({ urls, at });
        return true;
      },
    },
    sidebar: {
      loadFile() {},
      postMessage() {},
      onMessage: (name, callback) => {
        sidebarHandlers[name] = callback;
      },
    },
    standaloneWindow: {},
  };
  loadModule('src/index.js', {
    iina,
    setTimeout() {},
    require: (path) => loadModule('src/' + path.slice(2)),
  });
  return { hooks, events, commands, appended, sidebarHandlers, properties, iina };
}

test('sidebar Play All appends all 79 remaining URLs even when titles contain commas', () => {
  const state = setup(() => assert.fail('No metadata lookup needed to append a queue'));
  state.events['iina.window-loaded']();
  const items = Array.from({ length: 80 }, (_, i) => ({
    streamUrl: `https://host/Videos/item${i}/stream?static=true&ApiKey=test-token`,
    title: i % 2 ? 'Flying a plane badly, on purpose' : 'The 36,000-Foot Submarine',
  }));
  state.sidebarHandlers['play-media-list']({ items });
  assert.equal(state.appended.length, 0, 'wait for the replacing first file to load');
  assert.equal(state.properties['stream-open-filename'], items[0].streamUrl);
  state.events['iina.file-loaded'](items[0].streamUrl);
  assert.equal(state.appended.length, 1);
  assert.equal(state.appended[0].urls.length, 79);
  assert.deepEqual(
    Array.from(state.appended[0].urls),
    items.slice(1).map((item) => item.streamUrl)
  );
  assert.equal(state.commands.filter((command) => command.name === 'loadfile').length, 0);
});
